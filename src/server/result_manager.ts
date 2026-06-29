import {
  Artifact,
  Message,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from '../index.js';
import { ServerCallContext } from './context.js';
import { AgentExecutionEvent, assertUnreachableEvent } from './events/execution_event_bus.js';
import { TaskStore } from './store.js';

/**
 * Per-(tenant, owner, taskId) write serializer shared across every
 * `ResultManager` instance in this process. Multiple RMs can run
 * concurrently against the same task (e.g. an AUTH_REQUIRED background
 * drain holds one while a follow-up `sendMessage` constructs a new one,
 * or `cancelTask` overlaps with a background drain). Without
 * serialization, two RMs racing on the same row would each load a
 * pre-sibling snapshot, merge against it, and the last writer would
 * silently overwrite the other's contribution.
 *
 * The lock key mirrors the {@link TaskStore} scoping contract so two
 * tenants (or two owners within the same tenant) reusing the same
 * `taskId` do not falsely serialize. In-process only; cross-process
 * serialization belongs in the {@link TaskStore} interface.
 */
const taskWriteLocks = new Map<string, Promise<unknown>>();

/**
 * Stable string key identifying a `(tenant, owner, taskId)` triple. The
 * NUL separator avoids collisions across boundary placements.
 */
function lockKey(context: ServerCallContext, taskId: string): string {
  const tenant = context.tenant ?? '';
  const owner = context.user?.userName ?? '';
  return `${tenant}\x00${owner}\x00${taskId}`;
}

/**
 * Runs `fn` serialized against any prior call for the same `key`,
 * chaining onto the existing promise so rejections don't block the queue
 * and evicting the map entry once the chain drains.
 */
async function serializeByScope<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = taskWriteLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  taskWriteLocks.set(key, next);
  const evict = (): void => {
    if (taskWriteLocks.get(key) === next) {
      taskWriteLocks.delete(key);
    }
  };
  void next.then(evict, evict);
  return next;
}

/**
 * Tracks the in-flight task/message state for a single A2A request and
 * persists updates to the {@link TaskStore}.
 *
 * Every external object handed to this class is deep-cloned via
 * `structuredClone` before being stored, and every object stored back
 * into the task is likewise a fresh clone, isolating internal state from
 * caller-side mutations.
 *
 * `processEvent` serializes all store-touching branches through a
 * per-(tenant, owner, taskId) lock shared across every `ResultManager`
 * instance in the process. Inside the lock we always re-load from the
 * store so a sibling RM's write isn't overwritten by a merge against a
 * stale cached snapshot.
 */
export class ResultManager {
  private readonly taskStore: TaskStore;
  private readonly serverCallContext: ServerCallContext;

  private currentTask?: Task;
  private latestUserMessage?: Message;
  private finalMessageResult?: Message;
  // taskId of the last event processed under the lock, used to warn if
  // an executor switches tasks mid-stream on the same RM.
  private lastSeenTaskId?: string;

  constructor(taskStore: TaskStore, serverCallContext: ServerCallContext) {
    this.taskStore = taskStore;
    this.serverCallContext = serverCallContext;
  }

  public setContext(latestUserMessage: Message): void {
    // Clone so caller-side mutation doesn't drift our internal copy.
    this.latestUserMessage = structuredClone(latestUserMessage);
  }

  /**
   * Processes an agent execution event and updates the task store.
   * Store-touching branches run under a per-(tenant, owner, taskId) lock
   * so concurrent RMs linearize their load-merge-save sequences. The
   * `message` branch is in-memory only and intentionally unlocked.
   */
  public async processEvent(event: AgentExecutionEvent): Promise<void> {
    switch (event.kind) {
      case 'message': {
        // Final-result messages may be returned to callers verbatim, so
        // store a defensive copy.
        this.finalMessageResult = structuredClone(event.data);
        break;
      }
      case 'task': {
        const taskEvent = event.data;
        if (!taskEvent.id) {
          // No key to serialize on — fall through unlocked. Shouldn't
          // happen for a valid Task event, but defending against it
          // keeps us crash-free on malformed payloads.
          await this.processTaskEventLocked(taskEvent);
          break;
        }
        await serializeByScope(lockKey(this.serverCallContext, taskEvent.id), () =>
          this.processTaskEventLocked(taskEvent)
        );
        break;
      }
      case 'statusUpdate': {
        const updateEvent = event.data;
        if (!updateEvent.taskId) {
          await this.applyStatusUpdate(updateEvent);
          break;
        }
        await serializeByScope(lockKey(this.serverCallContext, updateEvent.taskId), () =>
          this.applyStatusUpdate(updateEvent)
        );
        break;
      }
      case 'artifactUpdate': {
        const artifactEvent = event.data;
        if (!artifactEvent.taskId) {
          await this.applyArtifactUpdate(artifactEvent);
          break;
        }
        await serializeByScope(lockKey(this.serverCallContext, artifactEvent.taskId), () =>
          this.applyArtifactUpdate(artifactEvent)
        );
        break;
      }
      default:
        assertUnreachableEvent(event);
    }
  }

  /**
   * Warns when the executor publishes an event for a different `taskId`
   * than the previous event this RM observed. A single RM is scoped to
   * one request, so a mismatch indicates an executor bug.
   */
  private notePersistedTaskId(taskId: string | undefined): void {
    if (!taskId) return;
    if (this.lastSeenTaskId && this.lastSeenTaskId !== taskId) {
      console.warn(
        `ResultManager: event for task ${taskId} arrived after processing ` +
          `events for ${this.lastSeenTaskId}. This indicates the executor ` +
          `switched tasks mid-stream, which is not expected in normal operation.`
      );
    }
    this.lastSeenTaskId = taskId;
  }

  /**
   * Handles a `task` event under the per-taskId write lock. Always
   * re-loads from the store (no cached state) so a sibling RM's write
   * between our previous event and this one is observed by our merge.
   */
  private async processTaskEventLocked(taskEvent: Task): Promise<void> {
    this.notePersistedTaskId(taskEvent.id);

    // A Task event with no prior persisted task is the normal create
    // flow, so load directly rather than via `loadPersistedTask` (which
    // warns on misses).
    const persistedTask = taskEvent.id
      ? await this.taskStore.load(taskEvent.id, this.serverCallContext)
      : undefined;

    // Deep-clone the incoming Task so further executor mutations can't
    // leak into our state.
    const mergedTask: Task = structuredClone(taskEvent);

    if (persistedTask && persistedTask.id === taskEvent.id) {
      // Preserve persisted history when the incoming event omits it. If
      // the incoming event carries its own history, treat it as
      // authoritative (the executor is responsible for what's persisted).
      if ((!mergedTask.history || mergedTask.history.length === 0) && persistedTask.history) {
        mergedTask.history = structuredClone(persistedTask.history);
      }

      // Merge artifacts by `artifactId`; incoming wins for collisions.
      mergedTask.artifacts = this.mergeArtifacts(persistedTask.artifacts, taskEvent.artifacts);

      // Merge metadata; incoming wins for key collisions.
      if (persistedTask.metadata || taskEvent.metadata) {
        mergedTask.metadata = {
          ...structuredClone(persistedTask.metadata ?? {}),
          ...structuredClone(taskEvent.metadata ?? {}),
        };
      }
    }

    // Ensure the latest user message is in history. Clone again so the
    // same reference can't be shared between the history array and the
    // `latestUserMessage` slot when the same RM handles multiple events.
    if (this.latestUserMessage) {
      const latest = this.latestUserMessage;
      if (!mergedTask.history?.find((msg) => msg.messageId === latest.messageId)) {
        mergedTask.history = [structuredClone(latest), ...(mergedTask.history || [])];
      }
    }

    this.currentTask = mergedTask;
    await this.saveCurrentTask();
  }

  /**
   * Loads the task fresh from the store, warning if it doesn't exist.
   * Doesn't mutate `this.currentTask` so callers retain TypeScript
   * flow-narrowing on the result.
   */
  private async loadPersistedTask(
    taskId: string | undefined,
    eventName: string
  ): Promise<Task | undefined> {
    if (!taskId) return undefined;
    const loaded = await this.taskStore.load(taskId, this.serverCallContext);
    if (!loaded) {
      console.warn(`ResultManager: Received ${eventName} for unknown task ${taskId}`);
    }
    return loaded;
  }

  private async applyStatusUpdate(updateEvent: TaskStatusUpdateEvent): Promise<void> {
    this.notePersistedTaskId(updateEvent.taskId);

    const task = await this.loadPersistedTask(updateEvent.taskId, 'status update');
    if (!task || task.id !== updateEvent.taskId) {
      this.currentTask = task;
      return;
    }

    // Clone the incoming status so caller-side mutation can't drift state.
    task.status = structuredClone(updateEvent.status);
    const update = updateEvent.status?.message;
    if (update) {
      if (!task.history?.find((msg) => msg.messageId === update.messageId)) {
        task.history = [...(task.history || []), structuredClone(update)];
      }
    }
    this.currentTask = task;
    await this.saveCurrentTask();
  }

  private async applyArtifactUpdate(artifactEvent: TaskArtifactUpdateEvent): Promise<void> {
    const artifact = artifactEvent.artifact;
    if (!artifact) return;

    this.notePersistedTaskId(artifactEvent.taskId);

    const task = await this.loadPersistedTask(artifactEvent.taskId, 'artifact update');
    if (!task || task.id !== artifactEvent.taskId) {
      this.currentTask = task;
      return;
    }

    if (!task.artifacts) {
      task.artifacts = [];
    }
    const existingArtifactIndex = task.artifacts.findIndex(
      (art) => art.artifactId === artifact.artifactId
    );
    if (existingArtifactIndex !== -1) {
      if (artifactEvent.append) {
        // Clone incoming parts/metadata so the persisted artifact owns
        // its own deep copies.
        const existingArtifact = task.artifacts[existingArtifactIndex];
        existingArtifact.parts = [
          ...(existingArtifact.parts || []),
          ...structuredClone(artifact.parts || []),
        ];
        if (artifact.description) existingArtifact.description = artifact.description;
        if (artifact.name) existingArtifact.name = artifact.name;
        if (artifact.metadata)
          existingArtifact.metadata = {
            ...existingArtifact.metadata,
            ...structuredClone(artifact.metadata),
          };
      } else {
        task.artifacts[existingArtifactIndex] = structuredClone(artifact);
      }
    } else {
      task.artifacts.push(structuredClone(artifact));
    }
    this.currentTask = task;
    await this.saveCurrentTask();
  }

  /**
   * Merges artifact arrays, deduplicating by `artifactId`. Persisted
   * artifacts are retained and overlaid by any incoming artifact with
   * the same id; artifacts only in the incoming list are appended.
   * Every entry in the returned array is a fresh deep copy.
   */
  private mergeArtifacts(
    persisted: Artifact[] | undefined,
    incoming: Artifact[] | undefined
  ): Artifact[] {
    if (!persisted || persisted.length === 0) {
      return incoming ? structuredClone(incoming) : [];
    }
    if (!incoming || incoming.length === 0) {
      return structuredClone(persisted);
    }

    const incomingById = new Map<string, Artifact>();
    for (const art of incoming) {
      incomingById.set(art.artifactId, art);
    }

    const merged: Artifact[] = persisted.map((art) =>
      structuredClone(incomingById.get(art.artifactId) ?? art)
    );
    const seenIds = new Set(persisted.map((art) => art.artifactId));
    for (const art of incoming) {
      if (!seenIds.has(art.artifactId)) {
        merged.push(structuredClone(art));
      }
    }
    return merged;
  }

  private async saveCurrentTask(): Promise<void> {
    if (this.currentTask) {
      await this.taskStore.save(this.currentTask, this.serverCallContext);
    }
  }

  /**
   * Returns the final result (Message or Task) after the event stream
   * has been fully processed. Returns the internally-tracked object
   * directly (not a clone) so downstream callers can apply in-place
   * edits; safe because RMs are scoped to a single request and discarded
   * immediately after.
   */
  public getFinalResult(): Message | Task | undefined {
    if (this.finalMessageResult) {
      return this.finalMessageResult;
    }
    return this.currentTask;
  }

  /**
   * Returns the task currently being managed (created during, or started
   * with, agent execution). See {@link getFinalResult} for why this is
   * the internal reference rather than a clone.
   */
  public getCurrentTask(): Task | undefined {
    return this.currentTask;
  }
}

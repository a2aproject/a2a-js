import {
  Artifact,
  Message,
  Task,
  TaskState,
  TaskStatus,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  TimelineEntry,
} from '../index.js';
import { ServerCallContext } from './context.js';
import {
  AgentExecutionEvent,
  AgentEvent,
  assertUnreachableEvent,
} from './events/execution_event_bus.js';
import { TaskStore } from './store.js';
import { TERMINAL_STATE_LIST } from './utils.js';
import type { PluginManager, TaskEventInfo } from '../plugins/types.js';

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
 * Runs `fn` under the same per-task write lock {@link ResultManager} uses,
 * for writes made outside it (the follow-up message append in
 * `DefaultRequestHandler`), so their load-modify-save can't race a drain.
 */
export function withTaskWriteLock<T>(
  context: ServerCallContext,
  taskId: string,
  fn: () => Promise<T>
): Promise<T> {
  return serializeByScope(lockKey(context, taskId), fn);
}

/** Advances a task's `generation` by one and returns it; a task stored before v1.1 starts at 1. */
export function advanceGeneration(task: Task): number {
  task.generation = (task.generation ?? 0) + 1;
  return task.generation;
}

function sameStatus(left: TaskStatus | undefined, right: TaskStatus | undefined): boolean {
  if (!left || !right) {
    return left === right;
  }
  return JSON.stringify(TaskStatus.toJSON(left)) === JSON.stringify(TaskStatus.toJSON(right));
}

/** Returns a shallow copy of `event` with `generation` set; messages are returned as is. */
function withGeneration(
  event: AgentExecutionEvent,
  generation: number | undefined
): AgentExecutionEvent {
  switch (event.kind) {
    case 'message':
      return event;
    case 'task':
      return AgentEvent.task({ ...event.data, generation });
    case 'statusUpdate':
      return AgentEvent.statusUpdate({ ...event.data, generation });
    case 'artifactUpdate':
      return AgentEvent.artifactUpdate({ ...event.data, generation });
    default:
      assertUnreachableEvent(event);
  }
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
  private readonly plugins?: PluginManager;

  private currentTask?: Task;
  private latestUserMessage?: Message;
  private finalMessageResult?: Message;
  private pendingReport?: TaskEventInfo;
  // taskId of the last event processed under the lock, used to warn if
  // an executor switches tasks mid-stream on the same RM.
  private lastSeenTaskId?: string;

  constructor(taskStore: TaskStore, serverCallContext: ServerCallContext, plugins?: PluginManager) {
    this.taskStore = taskStore;
    this.serverCallContext = serverCallContext;
    this.plugins = plugins;
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
   *
   * Returns a copy of `event` carrying the task's new `generation` when
   * persisted, or `event` unchanged when nothing was written (e.g. a
   * standalone message or an ignored update). The input object is never
   * mutated.
   */
  public async processEvent(event: AgentExecutionEvent): Promise<AgentExecutionEvent> {
    let report: TaskEventInfo | undefined;
    try {
      await this.applyEvent(event);
    } finally {
      report = this.pendingReport;
      this.pendingReport = undefined;
    }
    // Report outside the lock, so a hook may write to the same task without deadlocking.
    if (report && this.plugins?.hasTaskHooks) {
      await this.plugins.onTaskEvent(report);
    }
    return report?.event ?? event;
  }

  private async applyEvent(event: AgentExecutionEvent): Promise<void> {
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
    const hasPersisted = Boolean(persistedTask && persistedTask.id === taskEvent.id);
    // The server owns `generation` and `timeline`; start from persisted state.
    mergedTask.generation = hasPersisted ? persistedTask!.generation : undefined;
    const generation = advanceGeneration(mergedTask);

    if (hasPersisted) {
      // Preserve persisted history when the incoming event omits it. If
      // the incoming event carries its own history, treat it as
      // authoritative (the executor is responsible for what's persisted).
      if ((!mergedTask.history || mergedTask.history.length === 0) && persistedTask!.history) {
        mergedTask.history = structuredClone(persistedTask!.history);
      }

      // Merge artifacts by `artifactId`; incoming wins for collisions.
      mergedTask.artifacts = this.mergeArtifacts(persistedTask!.artifacts, taskEvent.artifacts);

      // Merge metadata; incoming wins for key collisions.
      if (persistedTask!.metadata || taskEvent.metadata) {
        mergedTask.metadata = {
          ...structuredClone(persistedTask!.metadata ?? {}),
          ...structuredClone(taskEvent.metadata ?? {}),
        };
      }
    }

    const timeline: TimelineEntry[] =
      hasPersisted && persistedTask!.timeline ? structuredClone(persistedTask!.timeline) : [];

    // Ensure the latest user message is in history and timeline. Clone again so the
    // same reference can't be shared between arrays and `latestUserMessage`.
    if (this.latestUserMessage) {
      const latest = this.latestUserMessage;
      if (!mergedTask.history?.find((msg) => msg.messageId === latest.messageId)) {
        mergedTask.history = [structuredClone(latest), ...(mergedTask.history || [])];
      }
      const alreadyInTimeline = timeline.some(
        (entry) =>
          entry.entry?.$case === 'message' && entry.entry.value.messageId === latest.messageId
      );
      if (!alreadyInTimeline) {
        timeline.push({ entry: { $case: 'message', value: structuredClone(latest) }, generation });
      }
    }

    // Streaming turns open by echoing the persisted Task snapshot; don't record
    // an unchanged prior-turn status a second time after the new user message.
    const statusChanged =
      !hasPersisted ||
      !persistedTask!.timeline?.length ||
      !sameStatus(mergedTask.status, persistedTask!.status);
    if (mergedTask.status && statusChanged) {
      timeline.push({
        entry: { $case: 'status', value: structuredClone(mergedTask.status) },
        generation,
      });
    }
    if (timeline.length > 0) {
      mergedTask.timeline = timeline;
    } else {
      delete mergedTask.timeline;
    }

    this.currentTask = mergedTask;
    await this.saveCurrentTask(
      AgentEvent.task(taskEvent),
      hasPersisted ? persistedTask!.status?.state : undefined
    );
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

    // Terminal tasks are immutable: a late status update must
    // not roll a COMPLETED/FAILED/CANCELED/REJECTED task back into a
    // non-terminal state (or a different terminal state). Same-state
    // terminal updates (e.g. a final COMPLETED message arriving after the
    // COMPLETED status) are still applied.
    const persistedState = task.status?.state;
    if (
      persistedState !== undefined &&
      TERMINAL_STATE_LIST.includes(persistedState) &&
      updateEvent.status?.state !== persistedState
    ) {
      console.warn(
        `ResultManager: ignoring status update ${updateEvent.status?.state} for terminal ` +
          `task ${task.id} (${persistedState})`
      );
      this.currentTask = task;
      return;
    }

    const generation = advanceGeneration(task);

    // Clone the incoming status so caller-side mutation can't drift state.
    task.status = structuredClone(updateEvent.status);

    // Merge event-level metadata into the task; incoming wins for collisions.
    if (updateEvent.metadata) {
      task.metadata = {
        ...task.metadata,
        ...structuredClone(updateEvent.metadata),
      };
    }

    const update = updateEvent.status?.message;
    if (update) {
      if (!task.history?.find((msg) => msg.messageId === update.messageId)) {
        task.history = [...(task.history || []), structuredClone(update)];
      }
    }
    if (task.status) {
      task.timeline = [
        ...(task.timeline ?? []),
        { entry: { $case: 'status', value: structuredClone(task.status) }, generation },
      ];
    }
    this.currentTask = task;
    await this.saveCurrentTask(AgentEvent.statusUpdate(updateEvent), persistedState);
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

    advanceGeneration(task);

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

    // Merge event-level metadata into the task; incoming wins for collisions.
    if (artifactEvent.metadata) {
      task.metadata = {
        ...task.metadata,
        ...structuredClone(artifactEvent.metadata),
      };
    }

    this.currentTask = task;
    await this.saveCurrentTask(AgentEvent.artifactUpdate(artifactEvent), task.status?.state);
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

  private async saveCurrentTask(
    event: AgentExecutionEvent,
    fromState: TaskState | undefined
  ): Promise<void> {
    const task = this.currentTask;
    if (!task) {
      return;
    }
    await this.taskStore.save(task, this.serverCallContext);
    this.pendingReport = {
      taskId: task.id,
      fromState,
      toState: task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED,
      event: withGeneration(event, task.generation),
      task,
      context: this.serverCallContext,
    };
  }

  /**
   * Returns the final result (Message or Task) after the event stream
   * has been fully processed. Returns the internally-tracked reference,
   * so callers that trim or mutate the response must clone it first.
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

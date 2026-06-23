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
 * `ResultManager` instance in this process.
 *
 * Multiple `ResultManager`s can run concurrently against the same task:
 * - The AUTH_REQUIRED background drain holds one RM while a follow-up
 *   `sendMessage` constructs a new one (spec §7.6).
 * - INPUT_REQUIRED's `createOrGetByTaskId` bus reuse + a follow-up call.
 * - `cancelTask` overlapping with the background drain.
 * - Non-blocking `sendMessage` returning early while its drain continues.
 *
 * Each `processEvent` performs a load-merge-save sequence on the
 * `TaskStore`. Without serialization, two RMs racing on the same row
 * would each read a pre-sibling snapshot, merge against it, and the last
 * writer would silently overwrite the other's contribution (classic
 * lost-update). Wholesale-replace was bug-equivalent for both writers;
 * merge semantics make the race observable as missing history /
 * artifacts.
 *
 * Scoping: the lock key mirrors the {@link TaskStore} scoping contract
 * — `(tenant, owner, taskId)` — so two different tenants (or two
 * different owners within the same tenant) that happen to reuse the
 * same `taskId` do NOT serialize against each other. The `tenant` part
 * comes from {@link ServerCallContext.tenant}; the owner is derived
 * from `context.user.userName` (mirroring the default
 * {@link OwnerResolver}, `resolveUserScope`). Custom store owner
 * resolvers may produce a slightly different bucketing — this is an
 * acceptable approximation: the lock is at worst over-conservative
 * (serializing two callers that the store would have kept separate),
 * never under-conservative for the default scoping.
 *
 * Scope: in-process only. Cross-process serialization belongs in the
 * `TaskStore` interface (compare-and-swap or transactional `update`)
 * and is intentionally out of scope here.
 */
const taskWriteLocks = new Map<string, Promise<unknown>>();

/**
 * Builds a stable string key that uniquely identifies a `(tenant,
 * owner, taskId)` triple. The `\x00` separator guarantees there's no
 * collision between e.g. `{tenant: 'a\x00b', owner: 'c'}` and `{tenant:
 * 'a', owner: 'b\x00c'}` because the NUL byte cannot appear in the
 * input segments under any realistic header/identifier policy.
 */
function lockKey(context: ServerCallContext, taskId: string): string {
  const tenant = context.tenant ?? '';
  const owner = context.user?.userName ?? '';
  return `${tenant}\x00${owner}\x00${taskId}`;
}

/**
 * Runs `fn` serialized against any prior calls for the same `key`,
 * chaining onto the existing promise so rejections don't block the
 * queue and evicting the map entry once the chain drains.
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
 * Mutation safety: every external object handed to this class (event
 * payloads, user messages) is deep-cloned via `structuredClone` before
 * being stored, and every object stored back into the task is likewise a
 * fresh clone. This isolates `ResultManager`'s internal state from
 * caller-side mutations of the same event objects (and vice versa). The
 * `TaskStore.load` / `TaskStore.save` boundary clones independently, so
 * this class is safe to combine with stores that share references.
 *
 * Concurrency: `processEvent` serializes all store-touching branches
 * (`task` / `statusUpdate` / `artifactUpdate`) through a per-(tenant,
 * owner, `taskId`) lock shared across every `ResultManager` instance in
 * the process. The lock key mirrors {@link TaskStore} scoping so two
 * tenants (or two owners within the same tenant) reusing the same
 * `taskId` do not falsely serialize. Inside the lock we always
 * invalidate `currentTask` and re-load from the store, so a sibling
 * RM's write (e.g. the AUTH_REQUIRED background drain interleaving
 * with a follow-up `sendMessage`) cannot be silently overwritten by a
 * merge against a stale cached snapshot.
 */
export class ResultManager {
  private readonly taskStore: TaskStore;
  private readonly serverCallContext: ServerCallContext;

  private currentTask?: Task;
  private latestUserMessage?: Message; // To add to history if a new task is created
  private finalMessageResult?: Message; // Stores the message if it's the final result
  /**
   * The `taskId` from the last event this RM processed under the lock.
   * Used to surface a warning when an executor publishes events for a
   * different `taskId` on the same RM mid-stream — that's an executor
   * bug and not something the per-task lock can paper over.
   */
  private lastSeenTaskId?: string;

  constructor(taskStore: TaskStore, serverCallContext: ServerCallContext) {
    this.taskStore = taskStore;
    this.serverCallContext = serverCallContext;
  }

  public setContext(latestUserMessage: Message): void {
    // Clone so a caller mutating the message later (or reusing the object
    // across calls) can't perturb our internal copy.
    this.latestUserMessage = structuredClone(latestUserMessage);
  }

  /**
   * Processes an agent execution event and updates the task store.
   *
   * Store-touching branches run under `serializeByTaskId(taskId, ...)`
   * so concurrent RMs on the same task linearize their load-merge-save
   * sequences. The `message` branch only touches in-memory state and is
   * intentionally unlocked.
   *
   * @param event The agent execution event.
   */
  public async processEvent(event: AgentExecutionEvent): Promise<void> {
    switch (event.kind) {
      case 'message': {
        // In-memory only; no store I/O, so no lock needed.
        // Final-result messages may be returned to callers verbatim, so
        // store a defensive copy.
        this.finalMessageResult = structuredClone(event.data);
        // If a message is received, it's usually the final result,
        // but we continue processing to ensure task state (if any) is also saved.
        // The ExecutionEventQueue will stop after a message event.
        break;
      }
      case 'task': {
        const taskEvent = event.data;
        if (!taskEvent.id) {
          // No key to serialize on — fall through unlocked. This
          // shouldn't happen for a valid Task event but defending
          // against it keeps us crash-free on malformed payloads.
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
   * Warns once when the executor publishes an event for a different
   * `taskId` than the previous event this RM observed. A single RM is
   * scoped to one request and should only ever see events for one
   * `taskId`; a mismatch indicates an executor bug.
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
   * Handles a `task` event under the per-`taskId` write lock.
   *
   * Always re-loads from the store (no cached state from prior events)
   * so a sibling `ResultManager`'s write between our previous event and
   * this one is observed by our merge (instead of being silently
   * clobbered by a stale-snapshot merge).
   */
  private async processTaskEventLocked(taskEvent: Task): Promise<void> {
    this.notePersistedTaskId(taskEvent.id);

    // Receiving a Task event with no prior persisted task is the normal
    // create-flow, so we load directly rather than going through
    // `loadPersistedTask` (which warns on misses).
    const persistedTask = taskEvent.id
      ? await this.taskStore.load(taskEvent.id, this.serverCallContext)
      : undefined;

    // Deep-clone the incoming Task so further executor mutations or
    // caller-side reuse of the same event object can't leak into our
    // state.
    const mergedTask: Task = structuredClone(taskEvent);

    if (persistedTask && persistedTask.id === taskEvent.id) {
      // Preserve persisted history when the incoming Task event omits it.
      // If the incoming Task event carries its own history, treat it as
      // authoritative (the executor is responsible for what gets persisted
      // per §3.7).
      if ((!mergedTask.history || mergedTask.history.length === 0) && persistedTask.history) {
        mergedTask.history = structuredClone(persistedTask.history);
      }

      // Merge artifacts: keep persisted artifacts and overlay any incoming
      // ones (matched by artifactId). Incoming wins for collisions; new
      // ones are appended.
      mergedTask.artifacts = this.mergeArtifacts(persistedTask.artifacts, taskEvent.artifacts);

      // Merge metadata, incoming wins on key collisions. structuredClone
      // each half so nested values can't be shared with either source.
      if (persistedTask.metadata || taskEvent.metadata) {
        mergedTask.metadata = {
          ...structuredClone(persistedTask.metadata ?? {}),
          ...structuredClone(taskEvent.metadata ?? {}),
        };
      }
    }

    // Ensure the latest user message is in history if not already present.
    // `latestUserMessage` was already cloned in `setContext`, but clone
    // again so the same reference can't end up shared between the
    // history array and the `latestUserMessage` slot if the same
    // `ResultManager` is reused for multiple task events.
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
   * Returns the loaded task (or undefined) without mutating
   * `this.currentTask`, so callers can use the result with TypeScript's
   * flow-narrowing intact.
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

    // Under the per-taskId lock we always re-load fresh persisted state
    // so a sibling RM's write isn't overwritten by a stale-snapshot
    // merge.
    const task = await this.loadPersistedTask(updateEvent.taskId, 'status update');
    if (!task || task.id !== updateEvent.taskId) {
      this.currentTask = task;
      return;
    }

    // Clone the incoming status (and its nested message) so caller-side
    // mutation of the original event payload can't drift our state.
    task.status = structuredClone(updateEvent.status);
    const update = updateEvent.status?.message;
    if (update) {
      // Add message to history if not already present.
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

    // Under the per-taskId lock we always re-load fresh persisted state
    // so a sibling RM's write isn't overwritten by a stale-snapshot
    // merge.
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
        // Basic append logic, assuming parts are compatible.
        // Clone incoming parts/metadata so the persisted artifact owns
        // its own deep copies and the event payload can be reused
        // safely by the executor.
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
   * Merges artifact arrays, deduplicating by `artifactId`. Persisted artifacts
   * are retained and overlaid by any incoming artifact with the same id;
   * artifacts only present in the incoming list are appended. Order is
   * preserved (persisted first, then any newly-introduced incoming artifacts).
   *
   * Every artifact in the returned array is a fresh deep copy so subsequent
   * in-place mutations (e.g. by `applyArtifactUpdate`) can't leak into the
   * original `persisted` / `incoming` arrays the caller still holds.
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
   * Gets the final result, which could be a Message or a Task.
   * This should be called after the event stream has been fully processed.
   *
   * Returns a reference to the internally-tracked object (not a clone) so
   * that downstream callers like `_applyHistoryLengthSemantics` can apply
   * in-place edits. Safe because `ResultManager` instances are scoped to a
   * single request and discarded immediately after this is called.
   *
   * The returned `currentTask` reflects whatever this RM saw at the end
   * of its most recently completed `processEvent` (under the lock). A
   * sibling RM running concurrently for the same `taskId` may have
   * written newer state to the store after our last event; that's the
   * documented snapshot contract — `getCurrentTask()` returns "what we
   * processed", not "the store's current state".
   * @returns The final Message or the current Task.
   */
  public getFinalResult(): Message | Task | undefined {
    if (this.finalMessageResult) {
      return this.finalMessageResult;
    }
    return this.currentTask;
  }

  /**
   * Gets the task currently being managed by this ResultManager instance.
   * This task could be one that was started with or one created during agent execution.
   *
   * Returns the internal reference (see {@link getFinalResult} for the
   * rationale).
   * @returns The current Task or undefined if no task is active.
   */
  public getCurrentTask(): Task | undefined {
    return this.currentTask;
  }
}

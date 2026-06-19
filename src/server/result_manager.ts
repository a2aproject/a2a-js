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

export class ResultManager {
  private readonly taskStore: TaskStore;
  private readonly serverCallContext: ServerCallContext;

  private currentTask?: Task;
  private latestUserMessage?: Message; // To add to history if a new task is created
  private finalMessageResult?: Message; // Stores the message if it's the final result

  constructor(taskStore: TaskStore, serverCallContext: ServerCallContext) {
    this.taskStore = taskStore;
    this.serverCallContext = serverCallContext;
  }

  public setContext(latestUserMessage: Message): void {
    this.latestUserMessage = latestUserMessage;
  }

  /**
   * Processes an agent execution event and updates the task store.
   * @param event The agent execution event.
   */
  public async processEvent(event: AgentExecutionEvent): Promise<void> {
    switch (event.kind) {
      case 'message': {
        this.finalMessageResult = event.data;
        // If a message is received, it's usually the final result,
        // but we continue processing to ensure task state (if any) is also saved.
        // The ExecutionEventQueue will stop after a message event.
        break;
      }
      case 'task': {
        const taskEvent = event.data;

        // Merge with any persisted state instead of wholesale-replacing it.
        // A fresh Task event published on a follow-up turn (e.g. after
        // INPUT_REQUIRED) often has empty `history` / `artifacts`; replacing
        // would drop the entire conversation.
        //
        // Unlike status/artifact updates, receiving a Task event with no
        // prior persisted task is the normal create-flow, so we load
        // directly rather than going through `ensureTaskLoaded` (which
        // warns on misses).
        if (!this.currentTask && taskEvent.id) {
          const loaded = await this.taskStore.load(taskEvent.id, this.serverCallContext);
          if (loaded) {
            this.currentTask = loaded;
          }
        }
        const persistedTask =
          this.currentTask && this.currentTask.id === taskEvent.id ? this.currentTask : undefined;

        const mergedTask: Task = { ...taskEvent };

        if (persistedTask) {
          // Preserve persisted history when the incoming Task event omits it.
          // If the incoming Task event carries its own history, treat it as
          // authoritative (the executor is responsible for what gets persisted
          // per §3.7).
          if ((!mergedTask.history || mergedTask.history.length === 0) && persistedTask.history) {
            mergedTask.history = [...persistedTask.history];
          }

          // Merge artifacts: keep persisted artifacts and overlay any incoming
          // ones (matched by artifactId). Incoming wins for collisions; new
          // ones are appended.
          mergedTask.artifacts = this.mergeArtifacts(persistedTask.artifacts, taskEvent.artifacts);

          // Merge metadata, incoming wins on key collisions.
          if (persistedTask.metadata || taskEvent.metadata) {
            mergedTask.metadata = {
              ...(persistedTask.metadata ?? {}),
              ...(taskEvent.metadata ?? {}),
            };
          }
        }

        this.currentTask = mergedTask;

        // Ensure the latest user message is in history if not already present.
        if (this.latestUserMessage) {
          if (
            !this.currentTask.history?.find(
              (msg) => msg.messageId === this.latestUserMessage?.messageId
            )
          ) {
            this.currentTask.history = [
              this.latestUserMessage,
              ...(this.currentTask.history || []),
            ];
          }
        }
        await this.saveCurrentTask();
        break;
      }
      case 'statusUpdate': {
        await this.applyStatusUpdate(event.data);
        break;
      }
      case 'artifactUpdate': {
        await this.applyArtifactUpdate(event.data);
        break;
      }
      default:
        assertUnreachableEvent(event);
    }
  }

  private async ensureTaskLoaded(taskId: string | undefined, eventName: string): Promise<void> {
    if (!this.currentTask && taskId) {
      const loaded = await this.taskStore.load(taskId, this.serverCallContext);
      if (loaded) {
        this.currentTask = loaded;
      } else {
        console.warn(`ResultManager: Received ${eventName} for unknown task ${taskId}`);
      }
    }
  }

  private async applyStatusUpdate(updateEvent: TaskStatusUpdateEvent): Promise<void> {
    await this.ensureTaskLoaded(updateEvent.taskId, 'status update');

    if (this.currentTask && this.currentTask.id === updateEvent.taskId) {
      this.currentTask.status = updateEvent.status;
      const update = updateEvent.status?.message;
      if (update) {
        // Add message to history if not already present
        if (!this.currentTask.history?.find((msg) => msg.messageId === update.messageId)) {
          this.currentTask.history = [...(this.currentTask.history || []), update];
        }
      }
      await this.saveCurrentTask();
    }
  }

  private async applyArtifactUpdate(artifactEvent: TaskArtifactUpdateEvent): Promise<void> {
    const artifact = artifactEvent.artifact;
    if (!artifact) return;

    await this.ensureTaskLoaded(artifactEvent.taskId, 'artifact update');

    if (this.currentTask && this.currentTask.id === artifactEvent.taskId) {
      if (!this.currentTask.artifacts) {
        this.currentTask.artifacts = [];
      }
      const existingArtifactIndex = this.currentTask.artifacts.findIndex(
        (art) => art.artifactId === artifact.artifactId
      );
      if (existingArtifactIndex !== -1) {
        if (artifactEvent.append) {
          // Basic append logic, assuming parts are compatible
          // More sophisticated merging might be needed for specific part types
          const existingArtifact = this.currentTask.artifacts[existingArtifactIndex];
          existingArtifact.parts = [...(existingArtifact.parts || []), ...(artifact.parts || [])];
          if (artifact.description) existingArtifact.description = artifact.description;
          if (artifact.name) existingArtifact.name = artifact.name;
          if (artifact.metadata)
            existingArtifact.metadata = {
              ...existingArtifact.metadata,
              ...artifact.metadata,
            };
        } else {
          this.currentTask.artifacts[existingArtifactIndex] = artifact;
        }
      } else {
        this.currentTask.artifacts.push(artifact);
      }
      await this.saveCurrentTask();
    }
  }

  /**
   * Merges artifact arrays, deduplicating by `artifactId`. Persisted artifacts
   * are retained and overlaid by any incoming artifact with the same id;
   * artifacts only present in the incoming list are appended. Order is
   * preserved (persisted first, then any newly-introduced incoming artifacts).
   */
  private mergeArtifacts(
    persisted: Artifact[] | undefined,
    incoming: Artifact[] | undefined
  ): Artifact[] {
    if (!persisted || persisted.length === 0) {
      return incoming ? [...incoming] : [];
    }
    if (!incoming || incoming.length === 0) {
      return [...persisted];
    }

    const incomingById = new Map<string, Artifact>();
    for (const art of incoming) {
      incomingById.set(art.artifactId, art);
    }

    const merged: Artifact[] = persisted.map((art) => incomingById.get(art.artifactId) ?? art);
    const seenIds = new Set(persisted.map((art) => art.artifactId));
    for (const art of incoming) {
      if (!seenIds.has(art.artifactId)) {
        merged.push(art);
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
   * @returns The current Task or undefined if no task is active.
   */
  public getCurrentTask(): Task | undefined {
    return this.currentTask;
  }
}

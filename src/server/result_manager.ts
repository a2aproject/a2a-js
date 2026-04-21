import { Message, Task } from '../index.js';
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
        this.currentTask = { ...taskEvent }; // Make a copy

        // Ensure the latest user message is in history if not already present
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
        const updateEvent = event.data;
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
        } else if (!this.currentTask && updateEvent.taskId) {
          // Potentially an update for a task we haven't seen the 'task' event for yet,
          // or we are rehydrating. Attempt to load.
          const loaded = await this.taskStore.load(updateEvent.taskId, this.serverCallContext);
          if (loaded) {
            this.currentTask = loaded;
            this.currentTask.status = updateEvent.status;
            const update = updateEvent.status?.message;
            if (update) {
              if (!this.currentTask.history?.find((msg) => msg.messageId === update.messageId)) {
                this.currentTask.history = [...(this.currentTask.history || []), update];
              }
            }
            await this.saveCurrentTask();
          } else {
            console.warn(
              `ResultManager: Received status update for unknown task ${updateEvent.taskId}`
            );
          }
        }
        // If it's a final status update, the ExecutionEventQueue will stop.
        // The final result will be the currentTask.
        break;
      }
      case 'artifactUpdate': {
        const artifactEvent = event.data;
        const artifact = artifactEvent.artifact;
        if (this.currentTask && this.currentTask.id === artifactEvent.taskId && artifact) {
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
              existingArtifact.parts.push(...(artifact.parts || []));
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
        } else if (!this.currentTask && artifactEvent.taskId && artifact) {
          // Similar to status update, try to load if task not in memory
          const loaded = await this.taskStore.load(artifactEvent.taskId, this.serverCallContext);
          if (loaded) {
            this.currentTask = loaded;
            if (!this.currentTask.artifacts) this.currentTask.artifacts = [];
            // Apply artifact update logic (as above)
            const existingArtifactIndex = this.currentTask.artifacts.findIndex(
              (art) => art.artifactId === artifact.artifactId
            );
            if (existingArtifactIndex !== -1) {
              if (artifactEvent.append) {
                const existingArtifact = this.currentTask.artifacts[existingArtifactIndex];
                existingArtifact.parts.push(...(artifact.parts || []));
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
          } else {
            console.warn(
              `ResultManager: Received artifact update for unknown task ${artifactEvent.taskId}`
            );
          }
        }
        break;
      }
      default:
        assertUnreachableEvent(event);
    }
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

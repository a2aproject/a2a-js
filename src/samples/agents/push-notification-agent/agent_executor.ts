import { v4 as uuidv4 } from 'uuid';

import {
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Artifact,
  Role,
} from '../../../index.js';
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  AgentEvent,
} from '../../../server/index.js';

/**
 * A long-running executor used to demonstrate push notifications.
 *
 * It publishes the initial Task, then a sequence of "working" status updates
 * spaced over time, an artifact, and finally a "completed" status.
 *
 * Each event published here triggers the DefaultPushNotificationSender to
 * dispatch a webhook to the URL configured in the request's
 * `taskPushNotificationConfig`.
 *
 * Cancellation is supported by recording the taskId in an in-memory Set when
 * `cancelTask` is invoked and checking the flag at every yield point in
 * `execute`. A `try/finally` block guarantees that the entry is always
 * removed once `execute` returns. Without working cancellation here, a client
 * call to `client.cancelTask({ id })` (the SDK's invocation of the A2A
 * "Cancel Task" operation, exposed as `CancelTask` over JSON-RPC and
 * `POST /tasks/{id}:cancel` over HTTP+JSON/REST) issued mid-stream would
 * block the request handler in `DefaultRequestHandler.cancelTask` until a
 * terminal event is published.
 */
export class PushNotificationAgentExecutor implements AgentExecutor {
  private readonly cancelledTasks = new Set<string>();

  public cancelTask = async (taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {
    console.log(`[PushNotificationAgentExecutor] Cancellation requested for task ${taskId}`);
    this.cancelledTasks.add(taskId);
  };

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(
      `[PushNotificationAgentExecutor] Processing message ${userMessage.messageId} ` +
        `for task ${taskId} (context: ${contextId})`
    );

    try {
      // 1. Publish initial Task event if it's a new task.
      if (!existingTask) {
        const initialTask: Task = {
          id: taskId,
          contextId: contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            timestamp: new Date().toISOString(),
            message: undefined,
          },
          artifacts: [],
          history: [userMessage],
          metadata: userMessage.metadata,
        };
        eventBus.publish(AgentEvent.task(initialTask));
      }

      // 2. Publish a sequence of "working" status updates with progress messages,
      //    aborting early if cancellation is requested.
      const totalSteps = 3;
      for (let step = 1; step <= totalSteps; step++) {
        // Wait between updates to simulate real work and to space out webhook calls.
        await new Promise((resolve) => setTimeout(resolve, 1500));

        if (this.cancelledTasks.has(taskId)) {
          console.log(
            `[PushNotificationAgentExecutor] Aborting task ${taskId} at step ${step}/${totalSteps}.`
          );
          eventBus.publish(
            AgentEvent.statusUpdate({
              taskId,
              contextId,
              status: {
                state: TaskState.TASK_STATE_CANCELED,
                timestamp: new Date().toISOString(),
                message: undefined,
              },
              metadata: {},
            })
          );
          return;
        }

        const workingUpdate: TaskStatusUpdateEvent = {
          taskId: taskId,
          contextId: contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: {
              role: Role.ROLE_AGENT,
              messageId: uuidv4(),
              parts: [
                {
                  content: {
                    $case: 'text',
                    value: `Working... (step ${step}/${totalSteps})`,
                  },
                  metadata: undefined,
                  filename: '',
                  mediaType: 'text/plain',
                },
              ],
              taskId: taskId,
              contextId: contextId,
              extensions: [],
              metadata: {},
              referenceTaskIds: [],
            },
            timestamp: new Date().toISOString(),
          },
          metadata: {},
        };
        eventBus.publish(AgentEvent.statusUpdate(workingUpdate));
      }

      // 3. Publish an artifact with the result.
      const resultArtifact: Artifact = {
        artifactId: uuidv4(),
        name: 'Result',
        description: 'The final result from the long-running agent.',
        parts: [
          {
            content: { $case: 'text', value: 'Long-running task completed successfully.' },
            metadata: undefined,
            filename: '',
            mediaType: 'text/plain',
          },
        ],
        metadata: undefined,
        extensions: [],
      };

      const artifactUpdate: TaskArtifactUpdateEvent = {
        taskId: taskId,
        contextId: contextId,
        artifact: resultArtifact,
        lastChunk: true,
        append: false,
        metadata: undefined,
      };
      eventBus.publish(AgentEvent.artifactUpdate(artifactUpdate));

      // 4. Publish the final task status update.
      const finalUpdate: TaskStatusUpdateEvent = {
        taskId: taskId,
        contextId: contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
        metadata: undefined,
      };
      eventBus.publish(AgentEvent.statusUpdate(finalUpdate));

      console.log(`[PushNotificationAgentExecutor] Task ${taskId} finished with state: completed`);
    } finally {
      this.cancelledTasks.delete(taskId);
    }
  }
}

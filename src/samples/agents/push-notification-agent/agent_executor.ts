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
 */
export class PushNotificationAgentExecutor implements AgentExecutor {
  // No in-flight cancellation needed for this demo.
  public cancelTask = async (_taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {};

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(
      `[PushNotificationAgentExecutor] Processing message ${userMessage.messageId} ` +
        `for task ${taskId} (context: ${contextId})`
    );

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

    // 2. Publish a sequence of "working" status updates with progress messages.
    const totalSteps = 3;
    for (let step = 1; step <= totalSteps; step++) {
      // Wait between updates to simulate real work and to space out webhook calls.
      await new Promise((resolve) => setTimeout(resolve, 1500));

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
  }
}

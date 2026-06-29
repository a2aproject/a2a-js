import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import {
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  Message,
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
 * SampleAgentExecutor implements the agent's core logic.
 *
 * Cancellation is supported via the standard SDK pattern: `cancelTask` records
 * the taskId in an in-memory Set, and `execute` checks the flag at every
 * yield point. A `try/finally` block guarantees the entry is removed from
 * the Set regardless of how `execute` returns. Without this, a client call to
 * `client.cancelTask({ id })` (the SDK's invocation of the A2A "Cancel Task"
 * operation, exposed as `CancelTask` over JSON-RPC and
 * `POST /tasks/{id}:cancel` over HTTP+JSON/REST) issued against a streaming
 * request would block the request handler in
 * `DefaultRequestHandler.cancelTask` until a terminal event is published —
 * see `src/server/request_handler/default_request_handler.ts`.
 */
export class SampleAgentExecutor implements AgentExecutor {
  private readonly cancelledTasks = new Set<string>();

  public cancelTask = async (taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {
    console.log(`[SampleAgentExecutor] Cancellation requested for task ${taskId}`);
    this.cancelledTasks.add(taskId);
  };

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    // Determine IDs for the task and context
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(
      `[SampleAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
    );

    try {
      // 1. Every streaming turn must begin with a Task or Message event.
      const taskSnapshot: Task = existingTask ?? {
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
      eventBus.publish(AgentEvent.task(taskSnapshot));

      // 2. Publish "working" status update
      const workingStatusUpdate: TaskStatusUpdateEvent = {
        taskId: taskId,
        contextId: contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          message: {
            role: Role.ROLE_AGENT,
            messageId: uuidv4(),
            parts: [
              {
                content: { $case: 'text', value: 'Processing your question' },
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
      eventBus.publish(AgentEvent.statusUpdate(workingStatusUpdate));

      // 3. Compute the response and (briefly) yield, checking for cancellation.
      const agentReplyText = this.parseInputMessage(userMessage);
      console.info(`[SampleAgentExecutor] Prompt response: ${agentReplyText}`);

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate processing delay.

      if (this.cancelledTasks.has(taskId)) {
        console.log(`[SampleAgentExecutor] Aborting task ${taskId} after working step.`);
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

      // 4. Publish artifact with the result
      const artifactId = uuidv4();
      const resultArtifact: Artifact = {
        artifactId: artifactId,
        name: 'Result',
        description: 'The final result from the agent.',
        parts: [
          {
            content: { $case: 'text', value: agentReplyText },
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

      // 5. Publish final task status update (completed, no message)
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

      console.log(`[SampleAgentExecutor] Task ${taskId} finished with state: completed`);
    } finally {
      this.cancelledTasks.delete(taskId);
    }
  }

  parseInputMessage(message: Message): string {
    /** Process the user query and return a response. */
    const textPart = message.parts.find((part) => part.content?.$case === 'text');
    const query = textPart?.content?.$case === 'text' ? textPart.content.value.trim() : '';

    if (!query) {
      return 'Hello! Please provide a message for me to respond to.';
    }

    // Simple responses based on input
    const queryLower = query.toLowerCase();
    if (queryLower.includes('hello') || queryLower.includes('hi')) {
      return 'Hello World! Nice to meet you!';
    } else if (queryLower.includes('how are you')) {
      return "I'm doing great! Thanks for asking. How can I help you today?";
    } else if (queryLower.includes('goodbye') || queryLower.includes('bye')) {
      return 'Goodbye! Have a wonderful day!';
    } else {
      return `Hello World! You said: '${query}'. Thanks for your message!`;
    }
  }
}

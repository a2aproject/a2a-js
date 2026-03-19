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
import { AgentExecutor, RequestContext, ExecutionEventBus } from '../../../server/index.js';

/**
 * SampleAgentExecutor implements the agent's core logic.
 */
export class SampleAgentExecutor implements AgentExecutor {
  public cancelTask = async (_taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {};

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    // Determine IDs for the task and context
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(
      `[SampleAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
    );

    // 1. Publish initial Task event if it's a new task
    if (!existingTask) {
      const initialTask: Task = {
        id: taskId,
        contextId: contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          timestamp: new Date().toISOString(),
          update: undefined,
        },
        artifacts: [],
        history: [userMessage], // Start history with the current user message
        metadata: userMessage.metadata, // Carry over metadata from message if any
      };
      eventBus.publish(initialTask);
    }

    // 2. Publish "working" status update
    const workingStatusUpdate: TaskStatusUpdateEvent = {
      taskId: taskId,
      contextId: contextId,
      status: {
        state: TaskState.TASK_STATE_WORKING,
        update: {
          role: Role.ROLE_AGENT,
          messageId: uuidv4(),
          content: [{ part: { $case: 'text', value: 'Processing your question' } }],
          taskId: taskId,
          contextId: contextId,
          extensions: [],
          metadata: {},
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
      metadata: {},
    };
    eventBus.publish(workingStatusUpdate);

    // 3. Publish artifact with the result
    const agentReplyText = this.parseInputMessage(userMessage);
    console.info(`[SampleAgentExecutor] Prompt response: ${agentReplyText}`);

    const artifactId = uuidv4();
    const resultArtifact: Artifact = {
      artifactId: artifactId,
      name: 'Result',
      description: 'The final result from the agent.',
      parts: [{ part: { $case: 'text', value: agentReplyText } }],
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
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate processing delay
    eventBus.publish(artifactUpdate);

    // 4. Publish final task status update (completed, no message)
    const finalUpdate: TaskStatusUpdateEvent = {
      taskId: taskId,
      contextId: contextId,
      status: {
        state: TaskState.TASK_STATE_COMPLETED,
        timestamp: new Date().toISOString(),
        update: undefined,
      },
      final: true,
      metadata: undefined,
    };
    eventBus.publish(finalUpdate);

    console.log(`[SampleAgentExecutor] Task ${taskId} finished with state: completed`);
  }

  parseInputMessage(message: Message): string {
    /** Process the user query and return a response. */
    const textPart = message.content.find((part) => part.part?.$case === 'text');
    const query = textPart?.part?.$case === 'text' ? textPart.part.value.trim() : '';

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

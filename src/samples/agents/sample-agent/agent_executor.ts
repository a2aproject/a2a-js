import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import {
  Task,
  TaskStatusUpdateEvent,
  Message
} from "../../../index.js";
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
} from "../../../server/index.js";

/**
 * SampleAgentExecutor implements the agent's core logic.
 */
export class SampleAgentExecutor implements AgentExecutor {

  public cancelTask = async (
    taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> => { };

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
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
        kind: 'task',
        id: taskId,
        contextId: contextId,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        history: [userMessage], // Start history with the current user message
        metadata: userMessage.metadata, // Carry over metadata from message if any
      };
      eventBus.publish(initialTask);
    }

    // 2. Publish "working" status update
    const workingStatusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      status: {
        state: 'working',
        message: {
          kind: 'message',
          role: 'agent',
          messageId: uuidv4(),
          parts: [{ kind: 'text', text: 'Processing your question' }],
          taskId: taskId,
          contextId: contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    };
    eventBus.publish(workingStatusUpdate);

    // 3. Publish final task status update
    const agentReplyText = this.parseInputMessage(userMessage);
    console.info(`[SampleAgentExecutor] Prompt response: ${agentReplyText}`);
 
    const agentMessage: Message = {
      kind: 'message',
      role: 'agent',
      messageId: uuidv4(),
      parts: [{ kind: 'text', text: agentReplyText }],
      taskId: taskId,
      contextId: contextId,
    };

    const finalUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      status: {
        state: 'completed',
        message: agentMessage,
        timestamp: new Date().toISOString(),
      },
      final: true,
    };
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing delay
    eventBus.publish(finalUpdate);

    console.log(
      `[SampleAgentExecutor] Task ${taskId} finished with state: completed`
    );
  }

  parseInputMessage(message: Message): string {
    /** Process the user query and return a response. */
    const textPart = message.parts.find(part => part.kind === 'text');
    const query = textPart ? textPart.text.trim() : '';

    if (!query) {
      return "Hello! Please provide a message for me to respond to.";
    }

    // Simple responses based on input
    const queryLower = query.toLowerCase();
    if (queryLower.includes("hello") || queryLower.includes("hi")) {
      return "Hello World! Nice to meet you!";
    } else if (queryLower.includes("how are you")) {
      return "I'm doing great! Thanks for asking. How can I help you today?";
    } else if (queryLower.includes("goodbye") || queryLower.includes("bye")) {
      return "Goodbye! Have a wonderful day!";
    } else {
      return `Hello World! You said: '${query}'. Thanks for your message!`;
    }
  }
}
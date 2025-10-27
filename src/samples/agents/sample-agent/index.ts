import express from "express";
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import {
  AgentCard,
  Task,
  TaskStatusUpdateEvent,
  Message
} from "../../../index.js";
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler
} from "../../../server/index.js";
import { A2AExpressApp } from "../../../server/express/index.js";

/**
 * SampleAgentExecutor implements the agent's core logic.
 */
class SampleAgentExecutor implements AgentExecutor {

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

// --- Server Setup ---

const sampleAgentCard: AgentCard = {
  name: 'Sample Agent',
  description: 'A sample agent to test the stream functionality and simulate the flow of tasks statuses.',
  // Adjust the base URL and port as needed. /a2a is the default base in A2AExpressApp
  url: 'http://localhost:41241/',
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples' // Added provider URL
  },
  version: '1.0.0', // Incremented version
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: true, // The new framework supports streaming
    pushNotifications: false, // Assuming not implemented for this agent yet
    stateTransitionHistory: true, // Agent uses history
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'], // task-status is a common output mode
  skills: [
    {
      id: 'sample_agent',
      name: 'Sample Agent',
      description: 'Simulate the general flow of a streaming agent.',
      tags: ['sample'],
      examples: ["hi", "hello world", "how are you", "goodbye"],
      inputModes: ['text'], // Explicitly defining for skill
      outputModes: ['text', 'task-status'] // Explicitly defining for skill
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

async function main() {
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  const agentExecutor: AgentExecutor = new SampleAgentExecutor();

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(
    sampleAgentCard,
    taskStore,
    agentExecutor
  );

  // 4. Create and setup A2AExpressApp
  const appBuilder = new A2AExpressApp(requestHandler);
  const expressApp = appBuilder.setupRoutes(express());

  // 5. Start the server
  const PORT = process.env.PORT || 41241;
  expressApp.listen(PORT, () => {
    console.log(`[SampleAgent] Server using new framework started on http://localhost:${PORT}`);
    console.log(`[SampleAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
    console.log('[SampleAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);

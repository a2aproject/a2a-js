import express from 'express';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import { AgentCard, Task, TaskStatusUpdateEvent, Message } from '../../src/index.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
} from '../../src/server/index.js';
import { A2AExpressApp } from '../../src/server/express/index.js';

/**
 * SUTAgentExecutor implements the agent's core logic.
 */
class SUTAgentExecutor implements AgentExecutor {
  private runningTask: Set<string> = new Set();
  private lastContextId?: string;

  public cancelTask = async (taskId: string, eventBus: ExecutionEventBus): Promise<void> => {
    this.runningTask.delete(taskId);
    const cancelledUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: this.lastContextId,
      status: {
        state: 'canceled',
        timestamp: new Date().toISOString(),
      },
      final: true, // Cancellation is a final state
    };
    eventBus.publish(cancelledUpdate);
  };

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    // Determine IDs for the task and context
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    this.lastContextId = contextId;
    this.runningTask.add(taskId);

    console.log(
      `[SUTAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
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
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Simulate processing delay
    if (!this.runningTask.has(taskId)) {
      console.log(
        `[SUTAgentExecutor] Task ${taskId} was cancelled before processing could complete.`
      );
      return;
    }
    console.info(`[SUTAgentExecutor] Prompt response: ${agentReplyText}`);

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
        state: 'input-required',
        message: agentMessage,
        timestamp: new Date().toISOString(),
      },
      final: true,
    };
    eventBus.publish(finalUpdate);
  }

  parseInputMessage(message: Message): string {
    /** Process the user query and return a response. */
    const textPart = message.parts.find((part) => part.kind === 'text');
    const query = textPart ? textPart.text.trim() : '';

    if (!query) {
      return 'Hello! Please provide a message for me to respond to.';
    }

    // Simple responses based on input
    const queryLower = query.toLowerCase();
    if (queryLower.includes('hello') || queryLower.includes('hi')) {
      return 'Hello World! How are you?';
    } else if (queryLower.includes('how are you')) {
      return "I'm doing great! Thanks for asking. How can I help you today?";
    } else {
      return `Hello World! You said: '${query}'. Please, send me a new message.`;
    }
  }
}

// --- Server Setup ---

const SUTAgentCard: AgentCard = {
  name: 'SUT Agent',
  description: 'A sample agent to be used as SUT against tck tests.',
  // Adjust the base URL and port as needed. /a2a is the default base in A2AExpressApp
  url: 'http://localhost:41241/',
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples', // Added provider URL
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
      id: 'sut_agent',
      name: 'SUT Agent',
      description: 'Simulate the general flow of a streaming agent.',
      tags: ['sut'],
      examples: ['hi', 'hello world', 'how are you', 'goodbye'],
      inputModes: ['text'], // Explicitly defining for skill
      outputModes: ['text', 'task-status'], // Explicitly defining for skill
    },
  ],
  supportsAuthenticatedExtendedCard: false,
  preferredTransport: 'JSONRPC',
  additionalInterfaces: [{ url: 'http://localhost:41241', transport: 'JSONRPC' }],
};

async function main() {
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  const agentExecutor: AgentExecutor = new SUTAgentExecutor();

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(SUTAgentCard, taskStore, agentExecutor);

  // 4. Create and setup A2AExpressApp
  const appBuilder = new A2AExpressApp(requestHandler);
  const expressApp = appBuilder.setupRoutes(express());

  // 5. Start the server
  const PORT = process.env.PORT || 41241;
  expressApp.listen(PORT, (err) => {
    if (err) {
      throw err;
    }
    console.log(`[SUTAgent] Server using new framework started on http://localhost:${PORT}`);
    console.log(`[SUTAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
    console.log('[SUTAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);

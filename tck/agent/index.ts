import express from 'express';
import { Server, ServerCredentials } from '@grpc/grpc-js';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import {
  AgentCard,
  Task,
  TaskStatusUpdateEvent,
  Message,
  TaskState,
  Role,
} from '../../src/index.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
} from '../../src/server/index.js';
import {
  jsonRpcHandler,
  agentCardHandler,
  restHandler,
  UserBuilder,
} from '../../src/server/express/index.js';
import { grpcService, A2AService } from '../../src/server/grpc/index.js';

/**
 * SUTAgentExecutor implements the agent's core logic.
 */
class SUTAgentExecutor implements AgentExecutor {
  private runningTask: Set<string> = new Set();
  private lastContextId?: string;

  public cancelTask = async (taskId: string, eventBus: ExecutionEventBus): Promise<void> => {
    this.runningTask.delete(taskId);
    const cancelledUpdate: TaskStatusUpdateEvent = {
      taskId: taskId,
      contextId: this.lastContextId ?? uuidv4(),      status: {
        state: TaskState.TASK_STATE_CANCELED,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      metadata: {}, 
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
        id: taskId,
        contextId: contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          timestamp: new Date().toISOString(),
          message: undefined,
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
      contextId: contextId,      status: {
        state: TaskState.TASK_STATE_WORKING,
        message: {
          role: Role.ROLE_AGENT,
          messageId: uuidv4(),
          parts: [{ content: { $case: 'text', value: 'Processing your question' }, metadata: {}, filename: '', mediaType: 'text/plain' }],
          taskId: taskId,
          contextId: contextId,
          extensions: [] as any[],
          metadata: {}, 
        },
        timestamp: new Date().toISOString(),
      },
      metadata: {}, 
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
      role: Role.ROLE_AGENT,
      messageId: uuidv4(),
      parts: [{ content: { $case: 'text', value: agentReplyText }, metadata: {}, filename: '', mediaType: 'text/plain' }],
      taskId: taskId,
      contextId: contextId,
      extensions: [] as any[],
      metadata: {}, 
    };

    const finalUpdate: TaskStatusUpdateEvent = {
      taskId: taskId,
      contextId: contextId,      status: {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        message: agentMessage,
        timestamp: new Date().toISOString(),
      },
      metadata: {}, 
    };
    eventBus.publish(finalUpdate);
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
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples', // Added provider URL
  },
  documentationUrl: 'https://example.com/docs',
  securitySchemes: {},
  signatures: [] as any[],
  securityRequirements: [] as any[],
  version: '1.0.0',
  iconUrl: undefined,
  capabilities: {
    streaming: true, // The new framework supports streaming
    pushNotifications: false, // Assuming not implemented for this agent yet
    extensions: [] as any[],
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
      securityRequirements: [] as any[],
    },
  ],
  supportedInterfaces: [
    {
      url: 'http://localhost:41241/a2a/jsonrpc',
      protocolBinding: 'JSONRPC',
      protocolVersion: '0.3.0',
      tenant: '',
    },
    {
      url: 'http://localhost:41241/a2a/rest',
      protocolBinding: 'HTTP+JSON',
      protocolVersion: '0.3.0',
      tenant: '',
    },
    {
      url: 'http://localhost:41242',
      protocolBinding: 'GRPC',
      protocolVersion: '0.3.0',
      tenant: '',
    },
  ],
};

async function main() {
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  const agentExecutor: AgentExecutor = new SUTAgentExecutor();

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(SUTAgentCard, taskStore, agentExecutor);

  // 4. Setup Express app with modular handlers
  const expressApp = express();

  // Register agent card handler at well-known location (shared by all transports)
  expressApp.use(
    '/.well-known/agent-card.json',
    agentCardHandler({ agentCardProvider: requestHandler })
  );

  // Register JSON-RPC handler (preferred transport, backward compatible)
  expressApp.use(
    '/a2a/jsonrpc',
    jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );

  // Register HTTP+JSON/REST handler (new feature - additional transport)
  expressApp.use(
    '/a2a/rest',
    restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );

  // 5. Start the server
  const HTTP_PORT = process.env.HTTP_PORT || 41241;
  expressApp.listen(HTTP_PORT, (err) => {
    if (err) {
      throw err;
    }
    console.log(`[SUTAgent] HTTP server started on http://localhost:${HTTP_PORT}`);
    console.log(`[SUTAgent] Agent Card: http://localhost:${HTTP_PORT}/.well-known/agent-card.json`);
    console.log('[SUTAgent] Press Ctrl+C to stop the server');
  });

  // 6. Start the gRPC server on a different port
  const GRPC_PORT = process.env.GRPC_PORT || 41242;
  const grpcHandlerInstance = grpcService({
    requestHandler,
    userBuilder: UserBuilder.noAuthentication,
  });
  const server = new Server();
  server.addService(A2AService, grpcHandlerInstance);
  server.bindAsync(`localhost:${GRPC_PORT}`, ServerCredentials.createInsecure(), () => {
    console.log(`[SUTAgent] gRPC server running at localhost:${GRPC_PORT}`);
  });
}

main().catch(console.error);

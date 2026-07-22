/**
 * SUT agent for the a2a-tck `0.3.0.beta5` test suite — built on the
 * v1.0 SDK with the v0.3 compatibility layer enabled across every
 * transport. The TCK speaks v0.3 on the wire; the compat layer
 * translates v0.3 ↔ v1.0 inside the SDK so the agent executor only ever
 * sees v1.0 types.
 *
 * This is the canonical wiring:
 *
 *   - JSON-RPC over HTTP at `/a2a/jsonrpc` with
 *     `legacyCompat: { enabled: true }`.
 *   - HTTP+JSON/REST mounted at `/a2a/rest` with
 *     `legacyCompat: { enabled: true }` — the legacy router exposes
 *     v0.3 reference routes under `/a2a/rest/v1/...` while v1.0 routes
 *     stay at `/a2a/rest/...`.
 *   - gRPC at `localhost:41242` with both the v1.0 `A2AService` and the
 *     v0.3 `LegacyA2AService` registered on the same `grpc.Server`. The
 *     v1.0 gRPC service factory deliberately has no `legacyCompat`
 *     opt-in — v0.3 gRPC clients are served by registering
 *     `legacyGrpcService` alongside.
 *   - The well-known agent-card endpoint at `/.well-known/agent-card.json`
 *     with `legacyCompat: { enabled: true }` — the `A2A-Version` header
 *     (defaulting to `'0.3'` per spec §3.6.2) selects the v0.3-shaped
 *     hybrid card derived from the v0.3-tagged interfaces in
 *     `supportedInterfaces`.
 *
 * Each binding is declared twice — at v1.0 and at v0.3 — via
 * `duplicateInterfacesForLegacy`. v0.3 advertisement is strictly
 * per-interface.
 */

import express from 'express';
import { Server, ServerCredentials } from '@grpc/grpc-js';
import { v4 as uuidv4 } from 'uuid';

import {
  A2A_PROTOCOL_VERSION,
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
  AgentEvent,
} from '../../src/server/index.js';
import {
  jsonRpcHandler,
  agentCardHandler,
  restHandler,
  UserBuilder,
} from '../../src/server/express/index.js';
import { grpcService, A2AService } from '../../src/server/grpc/index.js';
import { LegacyA2AService, legacyGrpcService } from '../../src/compat/v0_3/server/grpc/index.js';

/**
 * SUTAgentExecutor implements the agent's core logic used by the TCK.
 */
class SUTAgentExecutor implements AgentExecutor {
  private runningTask: Set<string> = new Set();
  private taskContexts: Map<string, string> = new Map();

  public cancelTask = async (taskId: string, eventBus: ExecutionEventBus): Promise<void> => {
    this.runningTask.delete(taskId);
    const contextId = this.taskContexts.get(taskId) ?? uuidv4();
    this.taskContexts.delete(taskId);
    const cancelledUpdate: TaskStatusUpdateEvent = {
      taskId: taskId,
      contextId: contextId,
      status: {
        state: TaskState.TASK_STATE_CANCELED,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      metadata: {},
    };
    eventBus.publish(AgentEvent.statusUpdate(cancelledUpdate));
  };

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    this.taskContexts.set(taskId, contextId);
    this.runningTask.add(taskId);

    console.log(
      `[SUTAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
    );

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

    const agentReplyText = this.parseInputMessage(userMessage);
    await new Promise((resolve) => setTimeout(resolve, 3000));
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
      parts: [
        {
          content: { $case: 'text', value: agentReplyText },
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
    };

    const finalUpdate: TaskStatusUpdateEvent = {
      taskId: taskId,
      contextId: contextId,
      status: {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        message: agentMessage,
        timestamp: new Date().toISOString(),
      },
      metadata: {},
    };
    eventBus.publish(AgentEvent.statusUpdate(finalUpdate));
  }

  parseInputMessage(message: Message): string {
    const textPart = message.parts.find((part) => part.content?.$case === 'text');
    const query = textPart?.content?.$case === 'text' ? textPart.content.value.trim() : '';

    if (!query) {
      return 'Hello! Please provide a message for me to respond to.';
    }

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

const HTTP_PORT = Number(process.env.HTTP_PORT || 41241);
const GRPC_PORT = Number(process.env.GRPC_PORT || 41242);

// Each binding declared at both v1.0 and v0.3; v0.3 advertisement is
// strictly per-interface so the TCK (which speaks v0.3) finds an
// interface for every binding it probes.
const SUTAgentCard: AgentCard = {
  name: 'SUT Agent (compat)',
  description:
    'v1.0-native SUT agent for the a2a-tck v0.3 suite. The v0.3 compat ' +
    'layer is enabled on every transport, so the TCK can drive this ' +
    'agent unchanged.',
  supportedInterfaces: [
    {
      url: `http://localhost:${HTTP_PORT}/a2a/jsonrpc`,
      protocolBinding: 'JSONRPC',
      tenant: '',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
    {
      url: `http://localhost:${HTTP_PORT}/a2a/jsonrpc`,
      protocolBinding: 'JSONRPC',
      tenant: '',
      protocolVersion: '0.3',
    },
    {
      url: `http://localhost:${HTTP_PORT}/a2a/rest`,
      protocolBinding: 'HTTP+JSON',
      tenant: '',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
    {
      url: `http://localhost:${HTTP_PORT}/a2a/rest`,
      protocolBinding: 'HTTP+JSON',
      tenant: '',
      protocolVersion: '0.3',
    },
    {
      url: `http://localhost:${GRPC_PORT}`,
      protocolBinding: 'GRPC',
      tenant: '',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
    {
      url: `http://localhost:${GRPC_PORT}`,
      protocolBinding: 'GRPC',
      tenant: '',
      protocolVersion: '0.3',
    },
  ],
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples',
  },
  documentationUrl: 'https://example.com/docs',
  securitySchemes: {},
  signatures: [],
  securityRequirements: [],
  version: '1.0.0',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    extensions: [],
    extendedAgentCard: false,
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'],
  skills: [
    {
      id: 'sut_agent',
      name: 'SUT Agent',
      description: 'Simulate the general flow of a streaming agent.',
      tags: ['sut'],
      examples: ['hi', 'hello world', 'how are you', 'goodbye'],
      inputModes: ['text'],
      outputModes: ['text', 'task-status'],
      securityRequirements: [],
    },
  ],
};

async function main() {
  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new SUTAgentExecutor();
  const requestHandler = new DefaultRequestHandler(SUTAgentCard, taskStore, agentExecutor);

  const expressApp = express();

  // Agent card with compat: serves a hybrid v0.3 + v1.0 card for v0.3
  // clients (header missing or 0.3) and the v1.0 card for v1.0 clients.
  expressApp.use(
    '/.well-known/agent-card.json',
    agentCardHandler({
      agentCardProvider: requestHandler,
      legacyCompat: { enabled: true },
    })
  );

  // JSON-RPC with compat: same endpoint accepts both v1.0 and v0.3 bodies.
  expressApp.use(
    '/a2a/jsonrpc',
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
      legacyCompat: { enabled: true },
    })
  );

  // REST with compat: v1.0 routes at `/a2a/rest/...` AND v0.3 reference
  // routes at `/a2a/rest/v1/...` share the same mount point.
  expressApp.use(
    '/a2a/rest',
    restHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
      legacyCompat: { enabled: true },
    })
  );

  expressApp.listen(HTTP_PORT, (err) => {
    if (err) {
      throw err;
    }
    console.log(`[SUTAgent] HTTP server started on http://localhost:${HTTP_PORT}`);
    console.log(`[SUTAgent] Agent Card: http://localhost:${HTTP_PORT}/.well-known/agent-card.json`);
    console.log(`[SUTAgent] JSON-RPC  : http://localhost:${HTTP_PORT}/a2a/jsonrpc  (v1.0 + v0.3)`);
    console.log(`[SUTAgent] REST v1.0 : http://localhost:${HTTP_PORT}/a2a/rest`);
    console.log(`[SUTAgent] REST v0.3 : http://localhost:${HTTP_PORT}/a2a/rest/v1`);
    console.log('[SUTAgent] Press Ctrl+C to stop the server');
  });

  // gRPC: BOTH the v1.0 and v0.3 services on a single Server.
  const grpcServer = new Server();
  grpcServer.addService(
    A2AService,
    grpcService({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );
  grpcServer.addService(
    LegacyA2AService,
    legacyGrpcService({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );
  grpcServer.bindAsync(`localhost:${GRPC_PORT}`, ServerCredentials.createInsecure(), (err) => {
    if (err) {
      console.error('[SUTAgent] gRPC bind failed:', err);
      return;
    }
    console.log(`[SUTAgent] gRPC server running at localhost:${GRPC_PORT}  (v1.0 + v0.3)`);
  });
}

main().catch(console.error);

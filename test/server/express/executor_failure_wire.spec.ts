import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

import { jsonErrorHandler, jsonRpcHandler } from '../../../src/server/express/json_rpc_handler.js';
import { restHandler } from '../../../src/server/express/rest_handler.js';
import { UserBuilder } from '../../../src/server/express/common.js';
import { DefaultRequestHandler, InMemoryTaskStore } from '../../../src/server/index.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { AgentEvent } from '../../../src/server/events/execution_event_bus.js';
import { AgentCard, Message as ProtoMessage, Role, TaskState } from '../../../src/types/pb/a2a.js';
import { A2A_ERROR_CODE } from '../../../src/errors.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';
import { ServerCallContext } from '../../../src/server/context.js';

describe('Executor failure — end-to-end wire behavior', () => {
  const agentCard: AgentCard = {
    name: 'Wire E2E Agent',
    description: 'Test agent for executor-throw wire assertions',
    version: '1.0.0',
    provider: undefined,
    documentationUrl: '',
    supportedInterfaces: [
      {
        url: 'http://localhost/a2a',
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: 'http://localhost/rpc',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      extensions: [],
      streaming: true,
      pushNotifications: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };

  let taskStore: InMemoryTaskStore;
  let mockExecutor: MockAgentExecutor;
  let handler: DefaultRequestHandler;

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    mockExecutor = new MockAgentExecutor();
    const busManager = new DefaultExecutionEventBusManager();
    handler = new DefaultRequestHandler(agentCard, taskStore, mockExecutor, busManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildJsonRpcApp = (): Express => {
    const app = express();
    const router = express.Router();
    router.use(express.json(), jsonErrorHandler);
    router.use(
      jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication })
    );
    app.use('/', router);
    return app;
  };

  const buildRestApp = (): Express => {
    const app = express();
    app.use(
      '/',
      restHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication })
    );
    return app;
  };

  const makeSendMessagePayload = (messageId: string, text: string) => ({
    jsonrpc: '2.0',
    id: 'req-1',
    method: 'SendMessage',
    params: {
      message: {
        messageId,
        role: 'ROLE_USER',
        parts: [{ text }],
      },
    },
  });

  describe('JSON-RPC transport', () => {
    it('executor throws → HTTP 200 JSON-RPC error envelope, no result field', async () => {
      const errorMessage = 'kaboom';
      mockExecutor.execute.mockRejectedValue(new Error(errorMessage));

      const app = buildJsonRpcApp();
      const response = await request(app)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(makeSendMessagePayload('msg-jsonrpc-fail', 'hi'))
        .expect(200);

      // Proper JSON-RPC error envelope (matches Python's -32603 mapping).
      expect(response.body).toMatchObject({
        jsonrpc: '2.0',
        id: 'req-1',
        error: {
          code: A2A_ERROR_CODE.INTERNAL_ERROR,
          message: errorMessage,
        },
      });
      // No accidental result field masquerading as success.
      expect(response.body.result).toBeUndefined();
    });

    it('executor publishes task then throws → JSON-RPC error envelope AND store shows FAILED', async () => {
      const errorMessage = 'post-task boom';
      let observedTaskId = '';
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        bus.publish(
          AgentEvent.task({
            id: ctx.taskId,
            contextId: ctx.contextId,
            status: {
              state: TaskState.TASK_STATE_SUBMITTED,
              message: undefined,
              timestamp: undefined,
            },
            artifacts: [],
            history: [],
            metadata: {},
          })
        );
        throw new Error(errorMessage);
      });

      const app = buildJsonRpcApp();
      const response = await request(app)
        .post('/')
        .set('A2A-Version', '1.0')
        .send(makeSendMessagePayload('msg-jsonrpc-fail-post', 'hi'))
        .expect(200);

      expect(response.body.error?.code).toBe(A2A_ERROR_CODE.INTERNAL_ERROR);
      expect(response.body.error?.message).toBe(errorMessage);
      expect(response.body.result).toBeUndefined();

      // Store must be updated to FAILED.
      const listing = await taskStore.list(
        { pageSize: 10 } as never,
        {
          tenant: '',
        } as never
      );
      expect(listing.tasks).toHaveLength(1);
      expect(listing.tasks[0].id).toBe(observedTaskId);
      expect(listing.tasks[0].status?.state).toBe(TaskState.TASK_STATE_FAILED);
    });

    it('streaming executor throws before any event → SSE error frame terminates the stream', async () => {
      const errorMessage = 'stream boom immediately';
      mockExecutor.execute.mockRejectedValue(new Error(errorMessage));

      const app = buildJsonRpcApp();
      const response = await request(app)
        .post('/')
        .set('A2A-Version', '1.0')
        .send({
          jsonrpc: '2.0',
          id: 'req-stream-1',
          method: 'SendStreamingMessage',
          params: {
            message: {
              messageId: 'msg-jsonrpc-stream-fail',
              role: 'ROLE_USER',
              parts: [{ text: 'hi' }],
            },
          },
        })
        .expect(200);

      // Pre-flush failure: Express layer catches the throw before any
      // SSE frame is written, so we get a JSON error envelope.
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body.error?.code).toBe(A2A_ERROR_CODE.INTERNAL_ERROR);
      expect(response.body.error?.message).toBe(errorMessage);
    });

    it('streaming executor throws AFTER first event → SSE terminates with `event: error` frame', async () => {
      const errorMessage = 'stream boom after first event';
      let observedTaskId = '';
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        bus.publish(
          AgentEvent.task({
            id: ctx.taskId,
            contextId: ctx.contextId,
            status: {
              state: TaskState.TASK_STATE_SUBMITTED,
              message: undefined,
              timestamp: undefined,
            },
            artifacts: [],
            history: [],
            metadata: {},
          })
        );
        throw new Error(errorMessage);
      });

      const app = buildJsonRpcApp();
      const response = await request(app)
        .post('/')
        .set('A2A-Version', '1.0')
        .send({
          jsonrpc: '2.0',
          id: 'req-stream-2',
          method: 'SendStreamingMessage',
          params: {
            message: {
              messageId: 'msg-jsonrpc-stream-fail-post',
              role: 'ROLE_USER',
              parts: [{ text: 'hi' }],
            },
          },
        })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');
      // The first (real) event flowed through, then a terminal error frame.
      expect(response.text).toContain('event: error');
      expect(response.text).toContain(errorMessage);

      // Store reflects the FAILED state.
      const stored = await taskStore.load(observedTaskId, { tenant: '' } as never);
      expect(stored?.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    });
  });

  describe('REST transport', () => {
    const makeRestMessagePayload = (messageId: string, text: string) => ({
      message: ProtoMessage.toJSON({
        messageId,
        role: Role.ROLE_USER,
        parts: [
          {
            content: { $case: 'text', value: text },
            filename: '',
            mediaType: 'text/plain',
            metadata: {},
          },
        ],
        taskId: '',
        contextId: '',
        extensions: [],
        metadata: {},
        referenceTaskIds: [],
      }),
    });

    it('executor throws → HTTP 500 with google.rpc.Status body carrying INTERNAL error', async () => {
      const errorMessage = 'rest boom';
      mockExecutor.execute.mockRejectedValue(new Error(errorMessage));

      const app = buildRestApp();
      const response = await request(app)
        .post('/message:send')
        .set('A2A-Version', '1.0')
        .set('Content-Type', 'application/json')
        .send(makeRestMessagePayload('msg-rest-fail', 'hi'))
        .expect(500);

      // REST error body wraps a google.rpc.Status-style object under
      // `error` (see toHTTPError in rest_transport_handler.ts).
      // Unknown errors map to gRPC status INTERNAL (13) → HTTP 500.
      expect(response.body.error).toEqual({
        code: 500,
        status: 'INTERNAL',
        message: errorMessage,
        details: [],
      });
    });

    it('executor throws → task still persisted as FAILED in the store', async () => {
      let observedTaskId = '';
      const errorMessage = 'rest post-task boom';
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        bus.publish(
          AgentEvent.task({
            id: ctx.taskId,
            contextId: ctx.contextId,
            status: {
              state: TaskState.TASK_STATE_SUBMITTED,
              message: undefined,
              timestamp: undefined,
            },
            artifacts: [],
            history: [],
            metadata: {},
          })
        );
        throw new Error(errorMessage);
      });

      const app = buildRestApp();
      await request(app)
        .post('/message:send')
        .set('A2A-Version', '1.0')
        .set('Content-Type', 'application/json')
        .send(makeRestMessagePayload('msg-rest-fail-post', 'hi'))
        .expect(500);

      const stored = await taskStore.load(observedTaskId, new ServerCallContext());
      expect(stored?.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    });
  });
});

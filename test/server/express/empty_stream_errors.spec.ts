import { describe, it, beforeEach, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as grpc from '@grpc/grpc-js';
import { DefaultRequestHandler, InMemoryTaskStore } from '../../../src/server/index.js';
import { AgentCard, Message, Role } from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { jsonRpcHandler } from '../../../src/server/express/json_rpc_handler.js';
import { restHandler } from '../../../src/server/express/rest_handler.js';
import { UserBuilder } from '../../../src/server/express/common.js';
import { grpcService } from '../../../src/server/grpc/grpc_service.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

describe('empty streaming responses across transports', () => {
  let handler: DefaultRequestHandler;
  let mockExecutor: MockAgentExecutor;
  const agentCard: AgentCard = {
    name: 'Streaming Errors Agent',
    description: 'Test agent for streaming-error synthesis assertions',
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
        url: 'http://localhost/a2a',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: 'http://localhost/a2a',
        protocolBinding: 'GRPC',
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

  beforeEach(() => {
    mockExecutor = new MockAgentExecutor();
    handler = new DefaultRequestHandler(
      agentCard,
      new InMemoryTaskStore(),
      mockExecutor,
      new DefaultExecutionEventBusManager()
    );
  });

  const makeMessage = (id: string, text: string, overrides: Partial<Message> = {}): Message => ({
    messageId: id,
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: 'text', value: text },
        mediaType: 'text/plain',
        filename: '',
        metadata: undefined,
      },
    ],
    taskId: '',
    contextId: '',
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
    ...overrides,
  });

  it('returns a JSON-RPC invalid agent response error when an executor produces no events', async () => {
    mockExecutor.execute.mockResolvedValue(undefined);
    const app = express();
    app.use(jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));

    const response = await request(app)
      .post('/')
      .set('A2A-Version', '1.0')
      .send({
        jsonrpc: '2.0',
        id: 'empty-stream',
        method: 'SendStreamingMessage',
        params: { message: { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: 'hello' }] } },
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 'empty-stream',
      error: { code: -32006 },
    });
  });

  it('returns an HTTP internal error when an executor produces no events', async () => {
    mockExecutor.execute.mockResolvedValue(undefined);
    const app = express();
    app.use(restHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));

    const response = await request(app)
      .post('/message:stream')
      .set('A2A-Version', '1.0')
      .set('Accept', 'text/event-stream')
      .send({ message: { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: 'hello' }] } });

    expect(response.status).toBe(500);
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    expect(response.body).toMatchObject({
      error: { code: 500, details: [{ reason: 'INVALID_AGENT_RESPONSE' }] },
    });
  });

  it('emits a gRPC INTERNAL error when an executor produces no events', async () => {
    mockExecutor.execute.mockResolvedValue(undefined);
    const service = grpcService({ requestHandler: handler, userBuilder: async () => undefined });
    const metadata = new grpc.Metadata();
    metadata.set('a2a-version', '1.0');
    const call = {
      request: { message: makeMessage('m1', 'hello'), tenant: '', metadata: {} },
      metadata,
      write: vi.fn(),
      end: vi.fn(),
      emit: vi.fn(),
      sendMetadata: vi.fn(),
    } as unknown as grpc.ServerWritableStream<any, any>;

    await service.sendStreamingMessage(call);

    expect(call.write).not.toHaveBeenCalled();
    expect(call.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ code: grpc.status.INTERNAL })
    );
    expect(call.end).toHaveBeenCalledOnce();
  });
});

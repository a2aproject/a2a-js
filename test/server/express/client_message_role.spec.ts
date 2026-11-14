import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { AgentCard, Role, TaskState } from '../../../src/index.js';
import { UserBuilder } from '../../../src/server/express/common.js';
import { jsonRpcHandler } from '../../../src/server/express/json_rpc_handler.js';
import { restHandler } from '../../../src/server/express/rest_handler.js';
import { AgentEvent, DefaultRequestHandler, InMemoryTaskStore } from '../../../src/server/index.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import type { AgentExecutor } from '../../../src/server/agent_execution/agent_executor.js';

const card: AgentCard = {
  name: 'role validation',
  description: 'Request role validation test agent',
  version: '1',
  provider: undefined,
  documentationUrl: '',
  supportedInterfaces: [
    { url: 'http://localhost', protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '1.0' },
    { url: 'http://localhost', protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '0.3' },
    { url: 'http://localhost', protocolBinding: 'HTTP+JSON', tenant: '', protocolVersion: '1.0' },
  ],
  capabilities: { streaming: true, pushNotifications: false, extensions: [] },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
  signatures: [],
};

function fixture() {
  const execute = vi.fn<AgentExecutor['execute']>(async (ctx, bus) => {
    bus.publish(
      AgentEvent.task({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      })
    );
    bus.finished();
  });
  const store = new InMemoryTaskStore();
  const save = vi.spyOn(store, 'save');
  const manager = new DefaultExecutionEventBusManager();
  const createBus = vi.spyOn(manager, 'createOrGetByTaskId');
  const handler = new DefaultRequestHandler(card, store, { execute, cancelTask: vi.fn() }, manager);
  const jsonrpc = express().use(
    jsonRpcHandler({
      requestHandler: handler,
      userBuilder: UserBuilder.noAuthentication,
      legacyCompat: { enabled: true },
    })
  );
  const rest = express().use(
    restHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication })
  );
  return { jsonrpc, rest, execute, save, createBus };
}

describe('client message role validation', () => {
  it.each(['SendMessage', 'SendStreamingMessage'])(
    'rejects invalid %s requests before execution',
    async (method) => {
      for (const role of ['ROLE_AGENT', 'ROLE_UNSPECIFIED', 'ROLE_BOGUS', undefined]) {
        const { jsonrpc, execute, save, createBus } = fixture();
        const response = await request(jsonrpc)
          .post('/')
          .set('A2A-Version', '1.0')
          .send({
            jsonrpc: '2.0',
            id: 'role-test',
            method,
            params: { message: { messageId: 'msg-role', role, parts: [{ text: 'hello' }] } },
          });
        expect(response.status).toBe(200);
        expect(response.body.error?.code).toBe(-32602);
        expect(response.body.id).toBe('role-test');
        expect(execute).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(createBus).not.toHaveBeenCalled();
      }
    }
  );

  it.each(['SendMessage', 'SendStreamingMessage'])(
    'accepts a v1 ROLE_USER request for %s',
    async (method) => {
      const { jsonrpc, execute } = fixture();
      const response = await request(jsonrpc)
        .post('/')
        .set('A2A-Version', '1.0')
        .send({
          jsonrpc: '2.0',
          id: 'valid-role',
          method,
          params: {
            message: { messageId: 'msg-user', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
          },
        });
      expect(response.status).toBe(200);
      expect(response.body.error).toBeUndefined();
      expect(execute).toHaveBeenCalledOnce();
      expect(execute.mock.calls[0][0].userMessage.role).toBe(Role.ROLE_USER);
    }
  );

  it.each(['/message:send', '/message:stream'])('rejects agent role over REST %s', async (path) => {
    const { rest, execute, save, createBus } = fixture();
    const response = await request(rest)
      .post(path)
      .set('A2A-Version', '1.0')
      .send({
        message: { messageId: 'msg-rest', role: 'ROLE_AGENT', parts: [{ text: 'hello' }] },
      });
    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(createBus).not.toHaveBeenCalled();
  });

  it.each(['message/send', 'message/stream'])(
    'validates v0.3 %s requests after translation',
    async (method) => {
      const { jsonrpc, execute } = fixture();
      const response = await request(jsonrpc)
        .post('/')
        .set('A2A-Version', '0.3')
        .send({
          jsonrpc: '2.0',
          id: 'legacy-role',
          method,
          params: {
            message: {
              kind: 'message',
              messageId: 'msg-legacy',
              role: 'agent',
              parts: [{ kind: 'text', text: 'hello' }],
            },
          },
        });
      expect(response.status).toBe(200);
      expect(response.body.error?.code).toBe(-32602);
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it('accepts a valid v0.3 user message', async () => {
    const { jsonrpc, execute } = fixture();
    const response = await request(jsonrpc)
      .post('/')
      .set('A2A-Version', '0.3')
      .send({
        jsonrpc: '2.0',
        id: 'legacy-user',
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-legacy-user',
            role: 'user',
            parts: [{ kind: 'text', text: 'hello' }],
          },
        },
      });
    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0].userMessage.role).toBe(Role.ROLE_USER);
  });
});

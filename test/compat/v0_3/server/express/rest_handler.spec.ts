import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { legacyRestRouter } from '../../../../../src/compat/v0_3/server/express/rest_handler.js';
import { UserBuilder } from '../../../../../src/server/express/common.js';
import { Role, TaskState } from '../../../../../src/types/pb/a2a.js';
import type { A2ARequestHandler } from '../../../../../src/server/request_handler/a2a_request_handler.js';
import type { AgentCard as V1AgentCard, Task as V1Task } from '../../../../../src/types/pb/a2a.js';

const agentCard: V1AgentCard = {
  name: 'Test',
  description: '',
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: false, extensions: [] },
  defaultInputModes: [],
  defaultOutputModes: [],
  skills: [],
  securityRequirements: [],
  securitySchemes: {},
  provider: undefined,
  signatures: [],
  supportedInterfaces: [
    { url: 'http://x', protocolBinding: 'HTTP+JSON', tenant: '', protocolVersion: '0.3' },
  ],
  documentationUrl: '',
  iconUrl: '',
};

function makeApp(handler: A2ARequestHandler) {
  const app = express();
  app.use(legacyRestRouter({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
  return app;
}

function newMockHandler(): A2ARequestHandler {
  return {
    getAgentCard: vi.fn().mockResolvedValue(agentCard),
    getAuthenticatedExtendedAgentCard: vi.fn(),
    sendMessage: vi.fn(),
    sendMessageStream: vi.fn(),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
    createTaskPushNotificationConfig: vi.fn(),
    getTaskPushNotificationConfig: vi.fn(),
    listTaskPushNotificationConfigs: vi.fn(),
    deleteTaskPushNotificationConfig: vi.fn(),
    resubscribe: vi.fn(),
    listTasks: vi.fn(),
  };
}

const validSendBody = {
  message: {
    message_id: 'm-1',
    role: 'ROLE_USER',
    content: [{ text: 'hi' }],
  },
};

describe('legacyRestRouter wire format', () => {
  let handler: A2ARequestHandler;

  beforeEach(() => {
    handler = newMockHandler();
  });

  it('emits top-level proto fields as snake_case', async () => {
    const task: V1Task = {
      id: 't-1',
      contextId: 'ctx-abc',
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
      artifacts: [],
      history: [],
      metadata: undefined,
    };
    (handler.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(task);

    const response = await request(makeApp(handler))
      .post('/v1/message:send')
      .set('Content-Type', 'application/json')
      .send(validSendBody)
      .expect(201);

    // Wire contract: snake_case keys, not camelCase.
    expect(response.body).toHaveProperty('task');
    expect(response.body.task).toHaveProperty('id', 't-1');
    expect(response.body.task).toHaveProperty('context_id', 'ctx-abc');
    expect(response.body.task).not.toHaveProperty('contextId');
  });

  it('passes user-supplied keys inside Task.metadata through untouched', async () => {
    // Arbitrary app-level metadata with camelCase keys the user authored.
    // Snake-casing these would corrupt their data.
    const task: V1Task = {
      id: 't-1',
      contextId: 'ctx-abc',
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
      artifacts: [],
      history: [],
      metadata: { myCustomField: 'value', anotherKey: 42, nestedObj: { keepAsIs: true } },
    };
    (handler.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(task);

    const response = await request(makeApp(handler))
      .post('/v1/message:send')
      .set('Content-Type', 'application/json')
      .send(validSendBody)
      .expect(201);

    expect(response.body.task.metadata).toEqual({
      myCustomField: 'value',
      anotherKey: 42,
      nestedObj: { keepAsIs: true },
    });
  });

  it('passes user-supplied keys inside DataPart.data through untouched', async () => {
    // Returns a Message whose part is a DataPart carrying a user-keyed object.
    // v1.0 Part.content.$case='data' value is the user map directly.
    (handler.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      messageId: 'm-resp',
      contextId: '',
      taskId: '',
      role: Role.ROLE_AGENT,
      parts: [
        {
          content: {
            $case: 'data',
            value: { userKey: 1, nested: { keepCamelCase: true } },
          },
          metadata: undefined,
          filename: '',
          mediaType: 'application/json',
        },
      ],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    });

    const response = await request(makeApp(handler))
      .post('/v1/message:send')
      .set('Content-Type', 'application/json')
      .send(validSendBody)
      .expect(201);

    expect(response.body).toHaveProperty('message');
    expect(response.body.message.content).toHaveLength(1);
    // Wire shape: `content[0].data` is the proto oneof discriminator for
    // DataPart; `.data.data` is the DataPart.data field (the user map).
    // The inner map's camelCase keys MUST round-trip unchanged.
    expect(response.body.message.content[0].data.data).toEqual({
      userKey: 1,
      nested: { keepCamelCase: true },
    });
  });

  it('passes user-supplied keys inside Message.metadata through untouched', async () => {
    (handler.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      messageId: 'm-resp',
      contextId: '',
      taskId: '',
      role: Role.ROLE_AGENT,
      parts: [],
      metadata: { fooBar: 'baz', anotherCamelKey: [1, 2, 3] },
      extensions: [],
      referenceTaskIds: [],
    });

    const response = await request(makeApp(handler))
      .post('/v1/message:send')
      .set('Content-Type', 'application/json')
      .send(validSendBody)
      .expect(201);

    expect(response.body.message.metadata).toEqual({
      fooBar: 'baz',
      anotherCamelKey: [1, 2, 3],
    });
  });
});

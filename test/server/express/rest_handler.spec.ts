import { describe, it, beforeEach, afterEach, assert, expect, vi, Mock } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

import { restHandler, UserBuilder } from '../../../src/server/express/index.js';
import { A2ARequestHandler } from '../../../src/server/request_handler/a2a_request_handler.js';
import { AgentCard, Task, Message, TaskState } from '../../../src/index.js';
import {
  RequestMalformedError,
  TaskNotFoundError,
  TaskNotCancelableError,
} from '../../../src/errors.js';
import {
  ListTaskPushNotificationConfigResponse,
  Message as ProtoMessage,
  SendMessageResponse,
  TaskPushNotificationConfig,
} from '../../../src/types/pb/a2a_types.js';
import { FromProto } from '../../../src/types/converters/from_proto.js';

/**
 * Test suite for restHandler - HTTP+JSON/REST transport implementation
 *
 * This suite tests the REST API endpoints following the A2A specification:
 * - GET /v1/card - Agent card retrieval
 * - POST /v1/message:send - Send message (non-streaming)
 * - POST /v1/message:stream - Send message with SSE streaming
 * - GET /v1/tasks/:taskId - Get task status
 * - POST /v1/tasks/:taskId:cancel - Cancel task
 * - POST /v1/tasks/:taskId:subscribe - Resubscribe to task updates
 * - Push notification config CRUD operations
 */
describe('restHandler', () => {
  let mockRequestHandler: A2ARequestHandler;
  let app: Express;

  const testAgentCard: AgentCard = {
    protocolVersion: '0.3.0',
    name: 'Test Agent',
    description: 'An agent for testing purposes',
    url: 'http://localhost:8080',
    preferredTransport: 'HTTP+JSON',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extensions: [],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    securitySchemes: {},
    security: [],
    additionalInterfaces: [],
    provider: undefined,
    documentationUrl: '',
    supportsAuthenticatedExtendedCard: false,
    signatures: [],
  };

  // camelCase format (internal type)
  const testMessage: Message = {
    messageId: 'msg-1',
    role: 'user' as any,
    content: [{ part: { $case: 'text', value: 'Hello' } }],
    contextId: 'ctx-1',
    taskId: 'task-1',
    extensions: [],
    metadata: {},
  };

  const testTask: Task = {
    id: 'task-1',
    status: { state: TaskState.TASK_STATE_COMPLETED, update: undefined, timestamp: undefined },
    contextId: 'ctx-1',
    history: [],
    artifacts: [],
    metadata: {},
  };

  beforeEach(() => {
    mockRequestHandler = {
      getAgentCard: vi.fn().mockResolvedValue(testAgentCard),
      getAuthenticatedExtendedAgentCard: vi.fn().mockResolvedValue(testAgentCard),
      sendMessage: vi.fn(),
      sendMessageStream: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      setTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfigs: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      resubscribe: vi.fn(),
    };

    app = express();
    app.use(
      restHandler({
        requestHandler: mockRequestHandler,
        userBuilder: UserBuilder.noAuthentication,
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /v1/card', () => {
    it('should return the agent card with 200 OK', async () => {
      const response = await request(app).get('/v1/card').expect(200);

      // REST API returns data (format checked by handler)
      expect(mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).toHaveBeenCalledTimes(1);
      assert.deepEqual(response.body.name, testAgentCard.name);
    });

    it('should return 400 if getAuthenticatedExtendedAgentCard fails', async () => {
      (mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).mockRejectedValue(
        new RequestMalformedError('Card fetch failed')
      );

      const response = await request(app).get('/v1/card').expect(400);

      assert.property(response.body, 'name');
      assert.property(response.body, 'message');
    });
  });

  describe('POST /v1/message:send', () => {
    it('should accept camelCase message and return 201 with Task', async () => {
      const message = ProtoMessage.toJSON(testMessage);
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      const response = await request(app)
        .post('/v1/message:send')
        .send({ request: message })
        .expect(201);

      expect(mockRequestHandler.sendMessage).toHaveBeenCalledWith(
        {
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
            kind: 'message',
            contextId: undefined,
            extensions: [],
            metadata: undefined,
            taskId: undefined,
          },
          configuration: undefined,
          metadata: undefined,
        },
        expect.anything()
      );

      const converted_result = FromProto.sendMessageResult(
        SendMessageResponse.fromJSON(response.body)
      );
      assert.deepEqual((converted_result as Task).id, testTask.id);
      // Kind is not present in Proto JSON
      assert.isUndefined(response.body.kind);
    });

    it('should return 400 when message is invalid', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        new RequestMalformedError('Message is required')
      );

      await request(app).post('/v1/message:send').send({ request: null }).expect(400);
    });
  });

  describe('POST /v1/message:stream', () => {
    it('should accept camelCase message and stream via SSE', async () => {
      const message = ProtoMessage.toJSON(testMessage);
      async function* mockStream() {
        yield testMessage;
        yield testTask;
      }
      (mockRequestHandler.sendMessageStream as Mock).mockResolvedValue(mockStream());

      const response = await request(app)
        .post('/v1/message:stream')
        .send({ request: message })
        .expect(200);

      assert.equal(response.headers['content-type'], 'text/event-stream');

      expect(mockRequestHandler.sendMessageStream).toHaveBeenCalledWith(
        {
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
            kind: 'message',
            contextId: undefined,
            extensions: [],
            metadata: undefined,
            taskId: undefined,
          },
          configuration: undefined,
          metadata: undefined,
        },
        expect.anything()
      );
    });

    it('should return 400 if streaming is not supported', async () => {
      const noStreamRequestHandler = {
        ...mockRequestHandler,
        getAgentCard: vi.fn().mockResolvedValue({
          ...testAgentCard,
          capabilities: { streaming: false, pushNotifications: false },
        }),
      };
      const noStreamApp = express();
      noStreamApp.use(
        restHandler({
          requestHandler: noStreamRequestHandler as any,
          userBuilder: UserBuilder.noAuthentication,
        })
      );

      await request(noStreamApp)
        .post('/v1/message:stream')
        .send({ request: testMessage })
        .expect(400);
    });
  });

  describe('GET /v1/tasks/:taskId', () => {
    it('should return task with 200 OK', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);

      const response = await request(app).get('/v1/tasks/task-1').expect(200);

      assert.deepEqual(response.body.id, testTask.id);
      // Kind is not present in Proto JSON
      assert.isUndefined(response.body.kind);
      // Status state is enum string
      assert.deepEqual(response.body.status.state, 'TASK_STATE_COMPLETED');
      expect(mockRequestHandler.getTask as Mock).toHaveBeenCalledWith(
        { name: 'tasks/task-1', historyLength: 0 },
        expect.anything()
      );
    });

    it('should support historyLength query parameter', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);

      await request(app).get('/v1/tasks/task-1?historyLength=10').expect(200);

      expect(mockRequestHandler.getTask as Mock).toHaveBeenCalledWith(
        {
          name: 'tasks/task-1',
          historyLength: 10,
        },
        expect.anything()
      );
    });

    it('should return 400 if historyLength is invalid', async () => {
      await request(app).get('/v1/tasks/task-1?historyLength=invalid').expect(400);
    });

    it('should return 404 if task is not found', async () => {
      (mockRequestHandler.getTask as Mock).mockRejectedValue(new TaskNotFoundError('task-1'));

      const response = await request(app).get('/v1/tasks/task-1').expect(404);

      assert.property(response.body, 'name');
      assert.property(response.body, 'message');
    });
  });

  describe('POST /v1/tasks/:taskId:cancel', () => {
    it('should cancel task and return 202 Accepted', async () => {
      const cancelledTask = { ...testTask, status: { state: TaskState.TASK_STATE_CANCELLED } };
      (mockRequestHandler.cancelTask as Mock).mockResolvedValue(cancelledTask);

      const response = await request(app).post('/v1/tasks/task-1:cancel').expect(202);

      assert.deepEqual(response.body.id, cancelledTask.id);
      assert.deepEqual(response.body.status.state, 'TASK_STATE_CANCELLED');

      expect(mockRequestHandler.cancelTask).toHaveBeenCalledWith(
        { id: 'task-1' },
        expect.anything()
      );
    });

    it('should return 404 if task is not found', async () => {
      (mockRequestHandler.cancelTask as Mock).mockRejectedValue(new TaskNotFoundError('task-1'));

      const response = await request(app).post('/v1/tasks/task-1:cancel').expect(404);

      assert.property(response.body, 'name');
      assert.property(response.body, 'message');
    });

    it('should return 409 if task is not cancelable', async () => {
      (mockRequestHandler.cancelTask as Mock).mockRejectedValue(
        new TaskNotCancelableError('task-1')
      );

      const response = await request(app).post('/v1/tasks/task-1:cancel').expect(409);

      assert.property(response.body, 'name');
      assert.property(response.body, 'message');
    });
  });

  describe('POST /v1/tasks/:taskId:subscribe', () => {
    it('should resubscribe to task updates via SSE', async () => {
      async function* mockStream() {
        yield testTask;
      }

      (mockRequestHandler.resubscribe as Mock).mockResolvedValue(mockStream());

      const response = await request(app).post('/v1/tasks/task-1:subscribe').expect(200);

      assert.equal(response.headers['content-type'], 'text/event-stream');

      expect(mockRequestHandler.resubscribe).toHaveBeenCalledWith(
        { id: 'task-1' },
        expect.anything()
      );
    });

    it('should return 400 if streaming is not supported', async () => {
      // Create new app with handler that has capabilities without streaming
      const noStreamRequestHandler = {
        ...mockRequestHandler,
        getAgentCard: vi.fn().mockResolvedValue({
          ...testAgentCard,
          capabilities: { streaming: false, pushNotifications: false },
        }),
      };
      const noStreamApp = express();
      noStreamApp.use(
        restHandler({
          requestHandler: noStreamRequestHandler as any,
          userBuilder: UserBuilder.noAuthentication,
        })
      );

      const response = await request(noStreamApp).post('/v1/tasks/task-1:subscribe').expect(400);

      assert.property(response.body, 'name');
      assert.property(response.body, 'message');
    });
  });

  describe('Push Notification Config Endpoints', () => {
    const mockConfig: any = {
      taskId: 'task-1',
      pushNotificationConfig: {
        id: 'config-1',
        url: 'https://example.com/webhook',
        token: '',
        authentication: undefined,
      },
    };

    describe('POST /v1/tasks/:taskId/pushNotificationConfigs', () => {
      it.each([
        {
          name: 'camelCase',
          payload: {
            parent: 'tasks/task-1',
            configId: 'push-954f670f-598d-49bf-9981-642d523f7746',
            config: {
              name: 'tasks/task-1/pushNotificationConfigs/push-954f670f-598d-49bf-9981-642d523f7746',
              pushNotificationConfig: {
                id: 'push-954f670f-598d-49bf-9981-642d523f7746',
                url: 'http://127.0.0.1:9999/webhook',
              },
            },
          },
        },
        {
          name: 'snake_case',
          payload: {
            parent: 'tasks/task-1',
            config_id: 'push-954f670f-598d-49bf-9981-642d523f7746',
            config: {
              name: 'tasks/task-1/pushNotificationConfigs/push-954f670f-598d-49bf-9981-642d523f7746',
              push_notification_config: {
                id: 'push-954f670f-598d-49bf-9981-642d523f7746',
                url: 'http://127.0.0.1:9999/webhook',
              },
            },
          },
        },
      ])('should accept $name config and return 201', async ({ payload }) => {
        (mockRequestHandler.setTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const response = await request(app)
          .post('/v1/tasks/task-1/pushNotificationConfigs')
          .send(payload)
          .expect(201);

        const protoResponse = FromProto.taskPushNotificationConfig(
          TaskPushNotificationConfig.fromJSON(response.body)
        );
        assert.deepEqual(protoResponse.taskId, mockConfig.taskId);

        expect(mockRequestHandler.setTaskPushNotificationConfig).toHaveBeenCalledWith(
          {
            taskId: 'task-1',
            pushNotificationConfig: {
              id: 'push-954f670f-598d-49bf-9981-642d523f7746',
              url: 'http://127.0.0.1:9999/webhook',
              token: undefined,
              authentication: undefined,
            },
          },
          expect.anything()
        );
      });

      it('should return 400 if push notifications not supported', async () => {
        const noPNRequestHandler = {
          ...mockRequestHandler,
          getAgentCard: vi.fn().mockResolvedValue({
            ...testAgentCard,
            capabilities: { streaming: false, pushNotifications: false },
          }),
        };
        const noPNApp = express();
        noPNApp.use(
          restHandler({
            requestHandler: noPNRequestHandler as any,
            userBuilder: UserBuilder.noAuthentication,
          })
        );

        await request(noPNApp)
          .post('/v1/tasks/task-1/pushNotificationConfigs')
          .send({
            pushNotificationConfig: {
              id: 'config-1',
              url: 'https://example.com/webhook',
              token: '',
              authentication: undefined,
            },
          })
          .expect(400);
      });
    });

    describe('GET /v1/tasks/:taskId/pushNotificationConfigs', () => {
      it('should list push notification configs and return 200', async () => {
        const configs = [mockConfig];
        (mockRequestHandler.listTaskPushNotificationConfigs as Mock).mockResolvedValue(configs);

        const response = await request(app)
          .get('/v1/tasks/task-1/pushNotificationConfigs')
          .expect(200);

        const convertedResult = ListTaskPushNotificationConfigResponse.fromJSON(
          response.body
        ).configs;
        assert.isArray(convertedResult);
        assert.lengthOf(convertedResult, configs.length);

        expect(mockRequestHandler.listTaskPushNotificationConfigs).toHaveBeenCalledWith(
          { id: 'task-1' },
          expect.anything()
        );
      });
    });

    describe('GET /v1/tasks/:taskId/pushNotificationConfigs/:configId', () => {
      it('should get specific push notification config and return 200', async () => {
        (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const response = await request(app)
          .get('/v1/tasks/task-1/pushNotificationConfigs/config-1')
          .expect(200);

        // REST API returns camelCase
        const convertedResult = FromProto.taskPushNotificationConfig(
          TaskPushNotificationConfig.fromJSON(response.body)
        );
        assert.deepEqual(convertedResult.taskId, mockConfig.taskId);

        expect(mockRequestHandler.getTaskPushNotificationConfig).toHaveBeenCalledWith(
          { id: 'task-1', pushNotificationConfigId: 'config-1' },
          expect.anything()
        );
      });

      it('should return 404 if config not found', async () => {
        (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockRejectedValue(
          new TaskNotFoundError('task-1')
        );

        const response = await request(app)
          .get('/v1/tasks/task-1/pushNotificationConfigs/config-1')
          .expect(404);

        assert.property(response.body, 'name');
        assert.property(response.body, 'message');
      });
    });

    describe('DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId', () => {
      it('should delete push notification config and return 204', async () => {
        (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockResolvedValue(undefined);

        await request(app).delete('/v1/tasks/task-1/pushNotificationConfigs/config-1').expect(204);

        expect(mockRequestHandler.deleteTaskPushNotificationConfig).toHaveBeenCalledWith(
          { id: 'task-1', pushNotificationConfigId: 'config-1' },
          expect.anything()
        );
      });

      it('should return 404 if config not found', async () => {
        (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockRejectedValue(
          new TaskNotFoundError('task-1')
        );

        const response = await request(app)
          .delete('/v1/tasks/task-1/pushNotificationConfigs/config-1')
          .expect(404);

        assert.property(response.body, 'name');
        assert.property(response.body, 'message');
      });
    });
  });

  /**
   * File Parts Format Tests
   */
  describe('File parts format acceptance', () => {
    it.each([
      {
        name: 'camelCase',
        payload: {
          message: {
            messageId: 'msg-parts',
            role: 'ROLE_USER',
            kind: 'message',
            content: [
              {
                file: {
                  fileWithUri: 'https://example.com/file.pdf',
                  mimeType: 'application/pdf',
                },
              },
              {
                text: 'Hello world',
              },
              {
                data: {
                  data: { foo: 'bar' },
                },
              },
            ],
          },
        },
      },
      {
        name: 'snake_case',
        payload: {
          message: {
            message_id: 'msg-parts',
            role: 'ROLE_USER',
            kind: 'message',
            content: [
              {
                file: {
                  file_with_uri: 'https://example.com/file.pdf',
                  mime_type: 'application/pdf',
                },
              },
              {
                text: 'Hello world',
              },
              {
                data: {
                  data: { foo: 'bar' },
                },
              },
            ],
          },
        },
      },
    ])('should accept $name message parts', async ({ payload }) => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);
      await request(app).post('/v1/message:send').send(payload).expect(201);

      expect(mockRequestHandler.sendMessage).toHaveBeenCalledWith(
        {
          message: {
            kind: 'message',
            messageId: 'msg-parts',
            role: 'user', // ROLE_USER is converted to 'user'
            parts: [
              {
                kind: 'file',
                file: {
                  uri: 'https://example.com/file.pdf',
                  mimeType: 'application/pdf',
                },
              },
              {
                kind: 'text',
                text: 'Hello world',
              },
              {
                kind: 'data',
                data: { foo: 'bar' },
              },
            ],
            contextId: undefined,
            extensions: [],
            metadata: undefined,
            taskId: undefined,
          },
          configuration: undefined,
          metadata: undefined,
        },
        expect.anything()
      );
    });
  });

  /**
   * Configuration Format Tests
   */
  describe('Configuration format acceptance', () => {
    it.each([
      {
        name: 'camelCase',
        payload: {
          message: { messageId: 'msg-1', role: 'ROLE_USER', kind: 'message' },
          configuration: { acceptedOutputModes: ['text/plain'], historyLength: 5 },
        },
      },
      {
        name: 'snake_case',
        payload: {
          message: { message_id: 'msg-1', role: 'ROLE_USER', kind: 'message' },
          configuration: { accepted_output_modes: ['text/plain'], history_length: 5 },
        },
      },
    ])('should accept $name configuration fields', async ({ payload }) => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);
      await request(app).post('/v1/message:send').send(payload).expect(201);

      expect(mockRequestHandler.sendMessage).toHaveBeenCalledWith(
        {
          message: {
            kind: 'message',
            messageId: 'msg-1',
            role: 'user', // ROLE_USER is converted to 'user'
            parts: [], // empty content converts to empty parts
            contextId: undefined,
            extensions: [],
            metadata: undefined,
            taskId: undefined,
          },
          configuration: {
            acceptedOutputModes: ['text/plain'],
            blocking: false,
            pushNotificationConfig: undefined,
          },
          metadata: undefined,
        },
        expect.anything()
      );
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown message action (route not matched)', async () => {
      // Unknown actions don't match the route pattern, so Express returns default 404
      await request(app).post('/v1/message:unknown').send({ request: testMessage }).expect(404);
    });

    it('should return 404 for unknown task action (route not matched)', async () => {
      // Unknown actions don't match the route pattern, so Express returns default 404
      await request(app).post('/v1/tasks/task-1:unknown').expect(404);
    });

    it('should handle internal server errors gracefully', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        new Error('Unexpected internal error')
      );

      const messageProto = ProtoMessage.toJSON(testMessage);
      const response = await request(app)
        .post('/v1/message:send')
        .send({ request: messageProto })
        .expect(500);

      assert.property(response.body, 'name');
      assert.property(response.body, 'message');
      assert.deepEqual(response.body.name, 'Error'); // Generic Error instance
    });
  });
});

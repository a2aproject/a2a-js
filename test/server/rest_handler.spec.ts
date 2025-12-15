import { describe, it, beforeEach, afterEach, assert, expect, vi, Mock } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

import { restHandler, UserBuilder } from '../../src/server/express/index.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { AgentCard, Task, Message } from '../../src/types.js';
import { A2AError } from '../../src/server/error.js';

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
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
  };

  // camelCase format (internal type)
  const testMessage: Message = {
    messageId: 'msg-1',
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: 'Hello' }],
    kind: 'message' as const,
  };

  // snake_case format (REST/TCK style input)
  const snakeCaseMessage = {
    message_id: 'msg-1',
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: 'Hello' }],
    kind: 'message' as const,
  };

  const testTask: Task = {
    id: 'task-1',
    kind: 'task' as const,
    status: { state: 'completed' as const },
    contextId: 'ctx-1',
    history: [],
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

    it('should return 500 if getAuthenticatedExtendedAgentCard fails', async () => {
      (mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).mockRejectedValue(
        A2AError.internalError('Card fetch failed')
      );

      const response = await request(app).get('/v1/card').expect(500);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
    });
  });

  describe('POST /v1/message:send', () => {
    it('should accept camelCase message and return 201 with Task', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      const response = await request(app)
        .post('/v1/message:send')
        .send({ message: testMessage })
        .expect(201);

      assert.deepEqual(response.body.id, testTask.id);
      assert.deepEqual(response.body.kind, 'task');
    });

    it('should accept snake_case message and return 201 with Task', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      const response = await request(app)
        .post('/v1/message:send')
        .send({ message: snakeCaseMessage })
        .expect(201);

      assert.deepEqual(response.body.id, testTask.id);
      assert.deepEqual(response.body.kind, 'task');
    });

    it('should return camelCase response regardless of input format', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      const response = await request(app)
        .post('/v1/message:send')
        .send({ message: snakeCaseMessage })
        .expect(201);

      // Response must be camelCase only
      assert.property(response.body, 'contextId');
      assert.notProperty(response.body, 'context_id');
    });

    it('should return 400 when message is invalid', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        A2AError.invalidParams('Message is required')
      );

      await request(app).post('/v1/message:send').send({ message: null }).expect(400);
    });
  });

  describe('POST /v1/message:stream', () => {
    it('should accept camelCase message and stream via SSE', async () => {
      async function* mockStream() {
        yield testMessage;
        yield testTask;
      }
      (mockRequestHandler.sendMessageStream as Mock).mockResolvedValue(mockStream());

      const response = await request(app)
        .post('/v1/message:stream')
        .send({ message: testMessage })
        .expect(200);

      assert.equal(response.headers['content-type'], 'text/event-stream');
    });

    it('should accept snake_case message and stream via SSE', async () => {
      async function* mockStream() {
        yield testMessage;
      }
      (mockRequestHandler.sendMessageStream as Mock).mockResolvedValue(mockStream());

      const response = await request(app)
        .post('/v1/message:stream')
        .send({ message: snakeCaseMessage })
        .expect(200);

      assert.equal(response.headers['content-type'], 'text/event-stream');
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
        .send({ message: testMessage })
        .expect(400);
    });
  });

  describe('GET /v1/tasks/:taskId', () => {
    it('should return task with 200 OK', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);

      const response = await request(app).get('/v1/tasks/task-1').expect(200);

      assert.deepEqual(response.body.id, testTask.id);
      assert.deepEqual(response.body.kind, 'task');
      expect(mockRequestHandler.getTask as Mock).toHaveBeenCalledWith(
        { id: 'task-1' },
        expect.anything()
      );
    });

    it('should support historyLength query parameter', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);

      await request(app).get('/v1/tasks/task-1?historyLength=10').expect(200);

      expect(mockRequestHandler.getTask as Mock).toHaveBeenCalledWith(
        {
          id: 'task-1',
          historyLength: 10,
        },
        expect.anything()
      );
    });

    it('should return 400 if historyLength is invalid', async () => {
      await request(app).get('/v1/tasks/task-1?historyLength=invalid').expect(400);
    });

    it('should return 404 if task is not found', async () => {
      (mockRequestHandler.getTask as Mock).mockRejectedValue(A2AError.taskNotFound('task-1'));

      const response = await request(app).get('/v1/tasks/task-1').expect(404);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
    });
  });

  describe('POST /v1/tasks/:taskId:cancel', () => {
    it('should cancel task and return 202 Accepted', async () => {
      const cancelledTask = { ...testTask, status: { state: 'canceled' as const } };
      (mockRequestHandler.cancelTask as Mock).mockResolvedValue(cancelledTask);

      const response = await request(app).post('/v1/tasks/task-1:cancel').expect(202);

      assert.deepEqual(response.body.id, cancelledTask.id);
      assert.deepEqual(response.body.status.state, 'canceled');
      expect(mockRequestHandler.cancelTask as Mock).toHaveBeenCalledWith(
        { id: 'task-1' },
        expect.anything()
      );
    });

    it('should return 404 if task is not found', async () => {
      (mockRequestHandler.cancelTask as Mock).mockRejectedValue(A2AError.taskNotFound('task-1'));

      const response = await request(app).post('/v1/tasks/task-1:cancel').expect(404);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
    });

    it('should return 409 if task is not cancelable', async () => {
      (mockRequestHandler.cancelTask as Mock).mockRejectedValue(
        A2AError.taskNotCancelable('task-1')
      );

      const response = await request(app).post('/v1/tasks/task-1:cancel').expect(409);

      assert.property(response.body, 'code');
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
      expect(mockRequestHandler.resubscribe as Mock).toHaveBeenCalledWith(
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

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
    });
  });

  describe('Push Notification Config Endpoints', () => {
    const mockConfig = {
      taskId: 'task-1',
      pushNotificationConfig: {
        id: 'config-1',
        url: 'https://example.com/webhook',
      },
    };

    describe('POST /v1/tasks/:taskId/pushNotificationConfigs', () => {
      it('should accept camelCase pushNotificationConfig and return 201', async () => {
        (mockRequestHandler.setTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const response = await request(app)
          .post('/v1/tasks/task-1/pushNotificationConfigs')
          .send({
            pushNotificationConfig: {
              id: 'config-1',
              url: 'https://example.com/webhook',
            },
          })
          .expect(201);

        assert.deepEqual(response.body.taskId, mockConfig.taskId);
      });

      it('should accept snake_case push_notification_config and return 201', async () => {
        (mockRequestHandler.setTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const response = await request(app)
          .post('/v1/tasks/task-1/pushNotificationConfigs')
          .send({
            push_notification_config: {
              id: 'config-1',
              url: 'https://example.com/webhook',
            },
          })
          .expect(201);

        assert.deepEqual(response.body.taskId, mockConfig.taskId);
      });

      it('should return camelCase response regardless of input format', async () => {
        (mockRequestHandler.setTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const response = await request(app)
          .post('/v1/tasks/task-1/pushNotificationConfigs')
          .send({
            push_notification_config: { id: 'config-1', url: 'https://example.com/webhook' },
          })
          .expect(201);

        // Response must be camelCase only
        assert.property(response.body, 'taskId');
        assert.property(response.body, 'pushNotificationConfig');
        assert.notProperty(response.body, 'task_id');
        assert.notProperty(response.body, 'push_notification_config');
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
          .send({ pushNotificationConfig: { id: 'config-1', url: 'https://example.com/webhook' } })
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

        assert.isArray(response.body);
        assert.lengthOf(response.body, configs.length);
      });
    });

    describe('GET /v1/tasks/:taskId/pushNotificationConfigs/:configId', () => {
      it('should get specific push notification config and return 200', async () => {
        (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const response = await request(app)
          .get('/v1/tasks/task-1/pushNotificationConfigs/config-1')
          .expect(200);

        // REST API returns camelCase
        assert.deepEqual(response.body.taskId, mockConfig.taskId);
        expect(mockRequestHandler.getTaskPushNotificationConfig as Mock).toHaveBeenCalledWith(
          {
            id: 'task-1',
            pushNotificationConfigId: 'config-1',
          },
          expect.anything()
        );
      });

      it('should return 404 if config not found', async () => {
        (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockRejectedValue(
          A2AError.taskNotFound('task-1')
        );

        const response = await request(app)
          .get('/v1/tasks/task-1/pushNotificationConfigs/config-1')
          .expect(404);

        assert.property(response.body, 'code');
        assert.property(response.body, 'message');
      });
    });

    describe('DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId', () => {
      it('should delete push notification config and return 204', async () => {
        (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockResolvedValue(undefined);

        await request(app).delete('/v1/tasks/task-1/pushNotificationConfigs/config-1').expect(204);

        expect(mockRequestHandler.deleteTaskPushNotificationConfig as Mock).toHaveBeenCalledWith(
          {
            id: 'task-1',
            pushNotificationConfigId: 'config-1',
          },
          expect.anything()
        );
      });

      it('should return 404 if config not found', async () => {
        (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockRejectedValue(
          A2AError.taskNotFound('task-1')
        );

        const response = await request(app)
          .delete('/v1/tasks/task-1/pushNotificationConfigs/config-1')
          .expect(404);

        assert.property(response.body, 'code');
        assert.property(response.body, 'message');
      });
    });
  });

  /**
   * File Parts Format Tests
   */
  describe('File parts format acceptance', () => {
    it('should accept camelCase mimeType in file parts', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      await request(app)
        .post('/v1/message:send')
        .send({
          message: {
            messageId: 'msg-file',
            role: 'user',
            kind: 'message',
            parts: [
              {
                kind: 'file',
                file: {
                  uri: 'https://example.com/file.pdf',
                  mimeType: 'application/pdf',
                  name: 'document.pdf',
                },
              },
            ],
          },
        })
        .expect(201);
    });

    it('should accept snake_case mime_type in file parts', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      await request(app)
        .post('/v1/message:send')
        .send({
          message: {
            message_id: 'msg-file',
            role: 'user',
            kind: 'message',
            parts: [
              {
                kind: 'file',
                file: {
                  uri: 'https://example.com/file.pdf',
                  mime_type: 'application/pdf',
                  name: 'document.pdf',
                },
              },
            ],
          },
        })
        .expect(201);
    });
  });

  /**
   * Configuration Format Tests
   */
  describe('Configuration format acceptance', () => {
    it('should accept camelCase configuration fields', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      await request(app)
        .post('/v1/message:send')
        .send({
          message: testMessage,
          configuration: {
            acceptedOutputModes: ['text/plain'],
            historyLength: 5,
          },
        })
        .expect(201);
    });

    it('should accept snake_case configuration fields', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      await request(app)
        .post('/v1/message:send')
        .send({
          message: snakeCaseMessage,
          configuration: {
            accepted_output_modes: ['text/plain'],
            history_length: 5,
          },
        })
        .expect(201);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown message action (route not matched)', async () => {
      // Unknown actions don't match the route pattern, so Express returns default 404
      await request(app).post('/v1/message:unknown').send({ message: testMessage }).expect(404);
    });

    it('should return 404 for unknown task action (route not matched)', async () => {
      // Unknown actions don't match the route pattern, so Express returns default 404
      await request(app).post('/v1/tasks/task-1:unknown').expect(404);
    });

    it('should handle internal server errors gracefully', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        new Error('Unexpected internal error')
      );

      const response = await request(app)
        .post('/v1/message:send')
        .send({ message: snakeCaseMessage })
        .expect(500);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
      assert.deepEqual(response.body.code, -32603); // Internal error code
    });
  });
});

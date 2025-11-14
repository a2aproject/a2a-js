import 'mocha';
import { assert } from 'chai';
import sinon, { SinonStub } from 'sinon';
import express, { Express } from 'express';
import request from 'supertest';

import { httpRestHandler } from '../../src/server/express/http_rest_handler.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { AgentCard, Task, Message } from '../../src/types.js';
import { A2AError } from '../../src/server/error.js';
import { internalToRest } from '../../src/server/express/utils.js';

/**
 * Test suite for httpRestHandler - HTTP+REST transport implementation
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
describe('httpRestHandler', () => {
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

  const testMessage: Message = {
    messageId: 'msg-1',
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
      getAgentCard: sinon.stub().resolves(testAgentCard),
      getAuthenticatedExtendedAgentCard: sinon.stub().resolves(testAgentCard),
      sendMessage: sinon.stub(),
      sendMessageStream: sinon.stub(),
      getTask: sinon.stub(),
      cancelTask: sinon.stub(),
      setTaskPushNotificationConfig: sinon.stub(),
      getTaskPushNotificationConfig: sinon.stub(),
      listTaskPushNotificationConfigs: sinon.stub(),
      deleteTaskPushNotificationConfig: sinon.stub(),
      resubscribe: sinon.stub(),
    };

    app = express();
    app.use(httpRestHandler({ requestHandler: mockRequestHandler }));
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('GET /v1/card', () => {
    it('should return the agent card with 200 OK', async () => {
      const response = await request(app).get('/v1/card').expect(200);

      // REST API returns snake_case, so compare with transformed expected data
      assert.deepEqual(response.body, internalToRest(testAgentCard));
      assert.isTrue((mockRequestHandler.getAuthenticatedExtendedAgentCard as SinonStub).calledOnce);
    });

    it('should return 500 if getAuthenticatedExtendedAgentCard fails', async () => {
      (mockRequestHandler.getAuthenticatedExtendedAgentCard as SinonStub).rejects(
        A2AError.internalError('Card fetch failed')
      );

      const response = await request(app).get('/v1/card').expect(500);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
    });
  });

  describe('POST /v1/message:send', () => {
    it('should send message and return 201 Created with Task', async () => {
      (mockRequestHandler.sendMessage as SinonStub).resolves(testTask);

      const response = await request(app)
        .post('/v1/message:send')
        .send({ message: testMessage })
        .expect(201);

      // REST API returns snake_case
      assert.deepEqual(response.body, internalToRest(testTask));
      assert.isTrue((mockRequestHandler.sendMessage as SinonStub).calledOnce);
    });

    it('should send message and return 201 Created with Message', async () => {
      (mockRequestHandler.sendMessage as SinonStub).resolves(testMessage);

      const response = await request(app)
        .post('/v1/message:send')
        .send({ message: testMessage })
        .expect(201);

      // REST API returns snake_case
      assert.deepEqual(response.body, internalToRest(testMessage));
    });

    it('should return 400 when message is invalid', async () => {
      (mockRequestHandler.sendMessage as SinonStub).rejects(
        A2AError.invalidParams('Message is required')
      );

      const response = await request(app)
        .post('/v1/message:send')
        .send({ message: null })
        .expect(400);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
    });
  });

  describe('POST /v1/message:stream', () => {
    it('should stream messages using Server-Sent Events', async () => {
      async function* mockStream() {
        yield testMessage;
        yield testTask;
      }

      (mockRequestHandler.sendMessageStream as SinonStub).resolves(mockStream());

      const response = await request(app)
        .post('/v1/message:stream')
        .send({ message: testMessage })
        .expect(200);

      assert.equal(response.headers['content-type'], 'text/event-stream');
      assert.isTrue((mockRequestHandler.sendMessageStream as SinonStub).calledOnce);
    });

    it('should return 501 if streaming is not supported', async () => {
      // Create new app with handler that has capabilities without streaming
      const noStreamRequestHandler = {
        ...mockRequestHandler,
        getAgentCard: sinon.stub().resolves({
          ...testAgentCard,
          capabilities: { streaming: false, pushNotifications: false },
        }),
      };
      const noStreamApp = express();
      noStreamApp.use(httpRestHandler({ requestHandler: noStreamRequestHandler as any }));

      const response = await request(noStreamApp)
        .post('/v1/message:stream')
        .send({ message: testMessage })
        .expect(501);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
    });
  });

  describe('GET /v1/tasks/:taskId', () => {
    it('should return task with 200 OK', async () => {
      (mockRequestHandler.getTask as SinonStub).resolves(testTask);

      const response = await request(app).get('/v1/tasks/task-1').expect(200);

      // REST API returns snake_case
      assert.deepEqual(response.body, internalToRest(testTask));
      assert.isTrue((mockRequestHandler.getTask as SinonStub).calledWith({ id: 'task-1' }));
    });

    it('should support historyLength query parameter', async () => {
      (mockRequestHandler.getTask as SinonStub).resolves(testTask);

      await request(app).get('/v1/tasks/task-1?historyLength=10').expect(200);

      assert.isTrue(
        (mockRequestHandler.getTask as SinonStub).calledWith({
          id: 'task-1',
          historyLength: 10,
        })
      );
    });

    it('should return 400 if historyLength is invalid', async () => {
      await request(app).get('/v1/tasks/task-1?historyLength=invalid').expect(400);
    });

    it('should return 404 if task is not found', async () => {
      (mockRequestHandler.getTask as SinonStub).rejects(A2AError.taskNotFound('task-1'));

      const response = await request(app).get('/v1/tasks/task-1').expect(404);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
    });
  });

  describe('POST /v1/tasks/:taskId:cancel', () => {
    it('should cancel task and return 202 Accepted', async () => {
      const cancelledTask = { ...testTask, status: { state: 'cancelled' as const } };
      (mockRequestHandler.cancelTask as SinonStub).resolves(cancelledTask);

      const response = await request(app).post('/v1/tasks/task-1:cancel').expect(202);

      // REST API returns snake_case
      assert.deepEqual(response.body, internalToRest(cancelledTask));
      assert.isTrue((mockRequestHandler.cancelTask as SinonStub).calledWith({ id: 'task-1' }));
    });

    it('should return 404 if task is not found', async () => {
      (mockRequestHandler.cancelTask as SinonStub).rejects(A2AError.taskNotFound('task-1'));

      const response = await request(app).post('/v1/tasks/task-1:cancel').expect(404);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
    });

    it('should return 409 if task is not cancelable', async () => {
      (mockRequestHandler.cancelTask as SinonStub).rejects(A2AError.taskNotCancelable('task-1'));

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

      (mockRequestHandler.resubscribe as SinonStub).resolves(mockStream());

      const response = await request(app).post('/v1/tasks/task-1:subscribe').expect(200);

      assert.equal(response.headers['content-type'], 'text/event-stream');
      assert.isTrue((mockRequestHandler.resubscribe as SinonStub).calledWith({ id: 'task-1' }));
    });

    it('should return 501 if streaming is not supported', async () => {
      // Create new app with handler that has capabilities without streaming
      const noStreamRequestHandler = {
        ...mockRequestHandler,
        getAgentCard: sinon.stub().resolves({
          ...testAgentCard,
          capabilities: { streaming: false, pushNotifications: false },
        }),
      };
      const noStreamApp = express();
      noStreamApp.use(httpRestHandler({ requestHandler: noStreamRequestHandler as any }));

      const response = await request(noStreamApp).post('/v1/tasks/task-1:subscribe').expect(501);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
    });
  });

  describe('Push Notification Config Endpoints', () => {
    const mockConfig = {
      id: 'config-1',
      taskId: 'task-1',
      url: 'https://example.com/webhook',
      events: ['message', 'task_status_update'],
    };

    describe('POST /v1/tasks/:taskId/pushNotificationConfigs', () => {
      it('should create push notification config and return 201', async () => {
        (mockRequestHandler.setTaskPushNotificationConfig as SinonStub).resolves(mockConfig);

        const response = await request(app)
          .post('/v1/tasks/task-1/pushNotificationConfigs')
          .send({ url: 'https://example.com/webhook', events: ['message'] })
          .expect(201);

        // REST API returns snake_case
        assert.deepEqual(response.body, internalToRest(mockConfig));
      });

      it('should return 501 if push notifications not supported', async () => {
        // Create new app with handler that has capabilities without push notifications
        const noPNRequestHandler = {
          ...mockRequestHandler,
          getAgentCard: sinon.stub().resolves({
            ...testAgentCard,
            capabilities: { streaming: false, pushNotifications: false },
          }),
        };
        const noPNApp = express();
        noPNApp.use(httpRestHandler({ requestHandler: noPNRequestHandler as any }));

        const response = await request(noPNApp)
          .post('/v1/tasks/task-1/pushNotificationConfigs')
          .send({ url: 'https://example.com/webhook', events: ['message'] })
          .expect(501);

        assert.property(response.body, 'code');
        assert.property(response.body, 'message');
      });
    });

    describe('GET /v1/tasks/:taskId/pushNotificationConfigs', () => {
      it('should list push notification configs and return 200', async () => {
        const configs = [mockConfig];
        (mockRequestHandler.listTaskPushNotificationConfigs as SinonStub).resolves(configs);

        const response = await request(app)
          .get('/v1/tasks/task-1/pushNotificationConfigs')
          .expect(200);

        // REST API returns snake_case
        assert.deepEqual(response.body, internalToRest(configs));
      });
    });

    describe('GET /v1/tasks/:taskId/pushNotificationConfigs/:configId', () => {
      it('should get specific push notification config and return 200', async () => {
        (mockRequestHandler.getTaskPushNotificationConfig as SinonStub).resolves(mockConfig);

        const response = await request(app)
          .get('/v1/tasks/task-1/pushNotificationConfigs/config-1')
          .expect(200);

        // REST API returns snake_case
        assert.deepEqual(response.body, internalToRest(mockConfig));
        assert.isTrue(
          (mockRequestHandler.getTaskPushNotificationConfig as SinonStub).calledWith({
            id: 'task-1',
            pushNotificationConfigId: 'config-1',
          })
        );
      });

      it('should return 404 if config not found', async () => {
        (mockRequestHandler.getTaskPushNotificationConfig as SinonStub).rejects(
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
        (mockRequestHandler.deleteTaskPushNotificationConfig as SinonStub).resolves();

        await request(app).delete('/v1/tasks/task-1/pushNotificationConfigs/config-1').expect(204);

        assert.isTrue(
          (mockRequestHandler.deleteTaskPushNotificationConfig as SinonStub).calledWith({
            id: 'task-1',
            pushNotificationConfigId: 'config-1',
          })
        );
      });

      it('should return 404 if config not found', async () => {
        (mockRequestHandler.deleteTaskPushNotificationConfig as SinonStub).rejects(
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
      (mockRequestHandler.sendMessage as SinonStub).rejects(new Error('Unexpected internal error'));

      const response = await request(app)
        .post('/v1/message:send')
        .send({ message: testMessage })
        .expect(500);

      assert.property(response.body, 'code');
      assert.property(response.body, 'message');
      assert.equal(response.body.code, -32603); // Internal error code
    });
  });
});

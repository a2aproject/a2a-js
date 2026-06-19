import {
  describe,
  it,
  beforeEach,
  afterEach,
  assert,
  expect,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

import { restHandler, UserBuilder } from '../../../src/server/express/index.js';
import { A2ARequestHandler } from '../../../src/server/request_handler/a2a_request_handler.js';
import { AgentCard, Task, Message, TaskState, Role } from '../../../src/index.js';
import {
  GenericError,
  RequestMalformedError,
  TaskNotFoundError,
  TaskNotCancelableError,
} from '../../../src/errors.js';
import {
  ListTaskPushNotificationConfigsResponse,
  Message as ProtoMessage,
  SendMessageResponse,
  TaskPushNotificationConfig,
} from '../../../src/types/pb/a2a.js';
import { FromProto } from '../../../src/types/converters/from_proto.js';
import { LegacyRestTransportHandler } from '../../../src/compat/v0_3/server/transports/rest/rest_transport_handler.js';

/**
 * Test suite for restHandler - HTTP+JSON/REST transport implementation
 *
 * This suite tests the REST API endpoints following the A2A specification:
 * - GET /extendedAgentCard - Agent card retrieval
 * - POST /message:send - Send message (non-streaming)
 * - POST /message:stream - Send message with SSE streaming
 * - GET /tasks/:taskId - Get task status
 * - GET /tasks - List tasks
 * - POST /tasks/:taskId:cancel - Cancel task
 * - POST /tasks/:taskId:subscribe - Resubscribe to task updates
 * - Push notification config CRUD operations
 */
describe('restHandler', () => {
  let mockRequestHandler: A2ARequestHandler;
  let app: Express;

  const testAgentCard: AgentCard = {
    name: 'Test Agent',
    description: 'An agent for testing purposes',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extensions: [],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    securityRequirements: [],
    securitySchemes: {},
    provider: { url: '', organization: '' },
    signatures: [],
    supportedInterfaces: [
      {
        url: 'http://localhost:8080/v1',
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    documentationUrl: '',
  };

  // camelCase format (internal type)
  const testMessage: Message = {
    messageId: 'msg-1',
    role: 'user' as any,
    parts: [
      {
        content: { $case: 'text', value: 'Hello' },
        filename: '',
        mediaType: 'text/plain',
        metadata: {},
      },
    ],
    contextId: 'ctx-1',
    taskId: 'task-1',
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  };

  const testTask: Task = {
    id: 'task-1',
    status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
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
      createTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfigs: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      resubscribe: vi.fn(),
      listTasks: vi.fn(),
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

  describe('GET /extendedAgentCard', () => {
    it('should return the agent card with 200 OK', async () => {
      const response = await request(app)
        .get('/extendedAgentCard')
        .set('A2A-Version', '1.0')
        .expect(200);

      // REST API returns data (format checked by handler)
      expect(mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).toHaveBeenCalledTimes(1);
      assert.deepEqual(response.body.name, testAgentCard.name);
    });

    it('should return the agent card with 200 OK when tenant is provided', async () => {
      const response = await request(app)
        .get('/tenant1/extendedAgentCard')
        .set('A2A-Version', '1.0')
        .expect(200);

      expect(mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).toHaveBeenCalledTimes(1);
      assert.deepEqual(response.body.name, testAgentCard.name);
    });

    it('should return 400 if getAuthenticatedExtendedAgentCard fails', async () => {
      (mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).mockRejectedValue(
        new RequestMalformedError('Card fetch failed')
      );

      const response = await request(app)
        .get('/extendedAgentCard')
        .set('A2A-Version', '1.0')
        .expect(400);

      assert.property(response.body, 'error');
      assert.equal(response.body.error.code, 400);
      assert.equal(response.body.error.details[0].reason, 'INVALID_PARAMS');
    });
  });

  describe('POST /message:send', () => {
    it('should accept camelCase message and return 200 with Task', async () => {
      const message = ProtoMessage.toJSON(testMessage);
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      const response = await request(app)
        .post('/message:send')
        .set('A2A-Version', '1.0')
        .send({ message })
        .expect(200);

      expect(mockRequestHandler.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            messageId: 'msg-1',
          }),
        }),
        expect.anything()
      );

      const converted_result = FromProto.sendMessageResult(
        SendMessageResponse.fromJSON(response.body)
      );
      assert.deepEqual((converted_result as Task).id, testTask.id);
      // Kind is not present in Proto JSON
      assert.isUndefined(response.body.kind);
    });

    it('should accept message with tenant prefix and pass tenant to handler', async () => {
      const message = ProtoMessage.toJSON(testMessage);
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      await request(app)
        .post('/tenant1/message:send')
        .set('A2A-Version', '1.0')
        .send({ message })
        .expect(200);

      expect(mockRequestHandler.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant: 'tenant1',
          message: expect.objectContaining({
            messageId: 'msg-1',
          }),
        }),
        expect.anything()
      );
    });

    it('should return 400 when message is invalid', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        new RequestMalformedError('Message is required')
      );

      await request(app)
        .post('/message:send')
        .set('A2A-Version', '1.0')
        .send({ request: null })
        .expect(400);
    });
  });

  describe('POST /message:stream', () => {
    it('should accept camelCase message and stream via SSE', async () => {
      const message = ProtoMessage.toJSON(testMessage);
      async function* mockStream() {
        yield testMessage;
        yield testTask;
      }
      (mockRequestHandler.sendMessageStream as Mock).mockResolvedValue(mockStream());

      const response = await request(app)
        .post('/message:stream')
        .set('A2A-Version', '1.0')
        .send({ message })
        .expect(200);

      assert.equal(response.headers['content-type'], 'text/event-stream');

      expect(mockRequestHandler.sendMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            messageId: 'msg-1',
          }),
        }),
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

      const response = await request(noStreamApp)
        .post('/message:stream')
        .set('A2A-Version', '1.0')
        .send({ request: testMessage })
        .expect(400);

      assert.property(response.body, 'error');
      assert.equal(response.body.error.details[0].reason, 'UNSUPPORTED_OPERATION');
    });
  });

  describe('GET /tasks/:taskId', () => {
    it('should return task with 200 OK', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);

      const response = await request(app)
        .get('/tasks/task-1')
        .set('A2A-Version', '1.0')
        .expect(200);

      assert.deepEqual(response.body.id, testTask.id);
      // Kind is not present in Proto JSON
      assert.isUndefined(response.body.kind);
      // Status state is enum string
      assert.deepEqual(response.body.status.state, 'TASK_STATE_COMPLETED');
      expect(mockRequestHandler.getTask as Mock).toHaveBeenCalledWith(
        { id: 'task-1', tenant: '' },
        expect.anything()
      );
    });

    it('should support historyLength query parameter', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);

      await request(app)
        .get('/tasks/task-1?historyLength=10')
        .set('A2A-Version', '1.0')
        .expect(200);

      expect(mockRequestHandler.getTask as Mock).toHaveBeenCalledWith(
        {
          id: 'task-1',
          tenant: '',
          historyLength: 10,
        },
        expect.anything()
      );
    });

    it('should return 400 if historyLength is invalid', async () => {
      await request(app)
        .get('/tasks/task-1?historyLength=invalid')
        .set('A2A-Version', '1.0')
        .expect(400);
    });

    it('should return 404 if task is not found', async () => {
      (mockRequestHandler.getTask as Mock).mockRejectedValue(new TaskNotFoundError('task-1'));

      const response = await request(app)
        .get('/tasks/task-1')
        .set('A2A-Version', '1.0')
        .expect(404);

      assert.property(response.body, 'error');
      assert.equal(response.body.error.code, 404);
      assert.equal(response.body.error.details[0].reason, 'TASK_NOT_FOUND');
    });
  });

  describe('POST /tasks/:taskId:cancel', () => {
    it('should cancel task and return 200 OK', async () => {
      // Returns 200 OK, not 202 Accepted: the response body is the
      // fully-materialized post-cancellation Task. a2a-go's v1.0 REST
      // client treats any non-200 status as a hard error (the body
      // is also discarded), so 202 would surface as `ErrServerError`
      // in cross-SDK calls even when the cancel actually succeeded.
      const cancelledTask = {
        ...testTask,
        status: { state: TaskState.TASK_STATE_CANCELED },
      };
      (mockRequestHandler.cancelTask as Mock).mockResolvedValue(cancelledTask);

      const response = await request(app)
        .post('/tasks/task-1:cancel')
        .set('A2A-Version', '1.0')
        .expect(200);

      assert.deepEqual(response.body.id, cancelledTask.id);
      assert.deepEqual(response.body.status.state, 'TASK_STATE_CANCELED');
      expect(mockRequestHandler.cancelTask as Mock).toHaveBeenCalledWith(
        { id: 'task-1', tenant: '', metadata: {} },
        expect.anything()
      );
    });

    it('should return 404 if task is not found', async () => {
      (mockRequestHandler.cancelTask as Mock).mockRejectedValue(new TaskNotFoundError('task-1'));

      const response = await request(app)
        .post('/tasks/task-1:cancel')
        .set('A2A-Version', '1.0')
        .expect(404);

      assert.property(response.body, 'error');
      assert.equal(response.body.error.code, 404);
      assert.equal(response.body.error.details[0].reason, 'TASK_NOT_FOUND');
    });

    it('should return 400 if task is not cancelable', async () => {
      (mockRequestHandler.cancelTask as Mock).mockRejectedValue(
        new TaskNotCancelableError('task-1')
      );

      const response = await request(app)
        .post('/tasks/task-1:cancel')
        .set('A2A-Version', '1.0')
        .expect(400);

      assert.property(response.body, 'error');
      assert.equal(response.body.error.details[0].reason, 'TASK_NOT_CANCELABLE');
    });
  });

  describe('GET /tasks', () => {
    it('should list a single task', async () => {
      const tasks = [testTask];
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({ tasks });

      const response = await request(app).get('/tasks').set('A2A-Version', '1.0').expect(200);

      const expectedResponse = [
        {
          id: testTask.id,
          contextId: testTask.contextId,
          status: {
            state: 'TASK_STATE_COMPLETED',
          },
          metadata: testTask.metadata,
        },
      ];

      assert.deepEqual(response.body.tasks, expectedResponse);
      expect(mockRequestHandler.listTasks as Mock).toHaveBeenCalled();
    });

    it('should list multiple tasks', async () => {
      const tasks = [testTask, { ...testTask, id: 'task-2' }];
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({ tasks });

      const response = await request(app).get('/tasks').set('A2A-Version', '1.0').expect(200);

      const expectedResponse = [
        {
          id: testTask.id,
          contextId: testTask.contextId,
          status: {
            state: 'TASK_STATE_COMPLETED',
          },
          metadata: testTask.metadata,
        },
        {
          id: 'task-2',
          contextId: testTask.contextId,
          status: {
            state: 'TASK_STATE_COMPLETED',
          },
          metadata: testTask.metadata,
        },
      ];

      assert.deepEqual(response.body.tasks, expectedResponse);
      expect(mockRequestHandler.listTasks as Mock).toHaveBeenCalled();
    });

    it('should parse string enum status filter', async () => {
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({ tasks: [testTask] });

      await request(app)
        .get('/tasks?status=TASK_STATE_COMPLETED')
        .set('A2A-Version', '1.0')
        .expect(200);

      const callArgs = (mockRequestHandler.listTasks as Mock).mock.calls[0][0];
      assert.equal(
        callArgs.status,
        TaskState.TASK_STATE_COMPLETED,
        'TASK_STATE_COMPLETED should parse to enum value (3)'
      );
    });

    it('should treat unrecognized status values as UNRECOGNIZED (-1)', async () => {
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({ tasks: [testTask] });

      await request(app).get('/tasks?status=INVALID_VALUE').set('A2A-Version', '1.0').expect(200);

      const callArgs = (mockRequestHandler.listTasks as Mock).mock.calls[0][0];
      assert.equal(
        callArgs.status,
        TaskState.UNRECOGNIZED,
        'Unrecognized status should return UNRECOGNIZED (-1)'
      );
    });

    it('should default to TASK_STATE_UNSPECIFIED when status is not provided', async () => {
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({ tasks: [testTask] });

      await request(app).get('/tasks').set('A2A-Version', '1.0').expect(200);

      const callArgs = (mockRequestHandler.listTasks as Mock).mock.calls[0][0];
      assert.equal(
        callArgs.status,
        TaskState.TASK_STATE_UNSPECIFIED,
        'Should default to TASK_STATE_UNSPECIFIED (0)'
      );
    });
  });

  describe('POST /tasks/:taskId:subscribe', () => {
    it('should resubscribe to task updates via SSE', async () => {
      async function* mockStream() {
        yield testTask;
      }

      (mockRequestHandler.resubscribe as Mock).mockReturnValue(mockStream());

      const response = await request(app)
        .post('/tasks/task-1:subscribe')
        .set('A2A-Version', '1.0')
        .expect(200);

      assert.equal(response.headers['content-type'], 'text/event-stream');
      expect(mockRequestHandler.resubscribe as Mock).toHaveBeenCalledWith(
        { id: 'task-1', tenant: '' },
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

      const response = await request(noStreamApp)
        .post('/tasks/task-1:subscribe')
        .set('A2A-Version', '1.0')
        .expect(400);

      assert.property(response.body, 'error');
      assert.equal(response.body.error.details[0].reason, 'UNSUPPORTED_OPERATION');
    });
  });

  describe('Push Notification Config Endpoints', () => {
    const mockConfig: TaskPushNotificationConfig = {
      tenant: '',
      taskId: 'task-1',
      id: 'config-1',
      url: 'https://example.com/webhook',
      token: '',
      authentication: undefined,
    };

    describe('POST /tasks/:taskId/pushNotificationConfigs', () => {
      it.each([
        {
          name: 'camelCase',
          payload: {
            id: 'push-954f670f-598d-49bf-9981-642d523f7746',
            url: 'http://127.0.0.1:9999/webhook',
            taskId: 'task-1',
            tenant: '',
          },
        },
        {
          name: 'snake_case',
          payload: {
            id: 'push-954f670f-598d-49bf-9981-642d523f7746',
            url: 'http://127.0.0.1:9999/webhook',
            taskId: 'task-1',
            tenant: '',
          },
        },
      ])('should accept $name config and return 201', async ({ payload }) => {
        (mockRequestHandler.createTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const response = await request(app)
          .post('/tasks/task-1/pushNotificationConfigs')
          .set('A2A-Version', '1.0')
          .send(payload)
          .expect(201);

        const protoResponse = TaskPushNotificationConfig.fromJSON(response.body);
        assert.equal(protoResponse.taskId, 'task-1');
        assert.equal(protoResponse.id, 'config-1');
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
          .post('/tasks/task-1/pushNotificationConfigs')
          .set('A2A-Version', '1.0')
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

    describe('GET /tasks/:taskId/pushNotificationConfigs', () => {
      it('should list push notification configs and return 200', async () => {
        const configs = [mockConfig];
        (mockRequestHandler.listTaskPushNotificationConfigs as Mock).mockResolvedValue({
          configs: configs,
          nextPageToken: '',
        });

        const response = await request(app)
          .get('/tasks/task-1/pushNotificationConfigs')
          .set('A2A-Version', '1.0')
          .expect(200);

        const convertedResult = ListTaskPushNotificationConfigsResponse.fromJSON(
          response.body
        ).configs;
        assert.isArray(convertedResult);
        assert.lengthOf(convertedResult, configs.length);
      });
    });

    describe('GET /tasks/:taskId/pushNotificationConfigs/:configId', () => {
      it('should get specific push notification config and return 200', async () => {
        (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const response = await request(app)
          .get('/tasks/task-1/pushNotificationConfigs/config-1')
          .set('A2A-Version', '1.0')
          .expect(200);

        // REST API returns camelCase
        const convertedResult = TaskPushNotificationConfig.fromJSON(response.body);
        assert.equal(convertedResult.taskId, 'task-1');
        expect(mockRequestHandler.getTaskPushNotificationConfig as Mock).toHaveBeenCalledWith(
          {
            id: 'config-1',
            taskId: 'task-1',
            tenant: '',
          },
          expect.anything()
        );
      });

      it('should return 404 if config not found', async () => {
        (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockRejectedValue(
          new TaskNotFoundError('task-1')
        );

        const response = await request(app)
          .get('/tasks/task-1/pushNotificationConfigs/config-1')
          .set('A2A-Version', '1.0')
          .expect(404);

        assert.property(response.body, 'error');
        assert.equal(response.body.error.code, 404);
        assert.equal(response.body.error.details[0].reason, 'TASK_NOT_FOUND');
      });
    });

    describe('DELETE /tasks/:taskId/pushNotificationConfigs/:configId', () => {
      it('should delete push notification config and return 204', async () => {
        (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockResolvedValue(undefined);

        await request(app)
          .delete('/tasks/task-1/pushNotificationConfigs/config-1')
          .set('A2A-Version', '1.0')
          .expect(204);

        expect(mockRequestHandler.deleteTaskPushNotificationConfig as Mock).toHaveBeenCalledWith(
          {
            id: 'config-1',
            taskId: 'task-1',
            tenant: '',
          },
          expect.anything()
        );
      });

      it('should return 404 if config not found', async () => {
        (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockRejectedValue(
          new TaskNotFoundError('task-1')
        );

        const response = await request(app)
          .delete('/tasks/task-1/pushNotificationConfigs/config-1')
          .set('A2A-Version', '1.0')
          .expect(404);

        assert.property(response.body, 'error');
        assert.equal(response.body.error.code, 404);
        assert.equal(response.body.error.details[0].reason, 'TASK_NOT_FOUND');
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
      await request(app).post('/message:send').set('A2A-Version', '1.0').send(payload).expect(200);
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
          message: testMessage,
          configuration: { acceptedOutputModes: ['text/plain'], historyLength: 5 },
        },
      },
      {
        name: 'snake_case',
        payload: {
          message: {
            message_id: 'msg-1',
            role: 'ROLE_USER',
            parts: [
              {
                content: { $case: 'text', value: 'Hello' },
                filename: '',
                media_type: 'text/plain',
                metadata: {},
              },
            ],
          },
          configuration: { accepted_output_modes: ['text/plain'], history_length: 5 },
        },
      },
    ])('should accept $name configuration fields', async ({ payload }) => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);
      await request(app).post('/message:send').set('A2A-Version', '1.0').send(payload).expect(200);

      const protoMessage = ProtoMessage.toJSON(testMessage);
      await request(app)
        .post('/message:send')
        .set('A2A-Version', '1.0')
        .send({ message: protoMessage, configuration: payload.configuration })
        .expect(200);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown message action (route not matched)', async () => {
      // Unknown actions don't match the route pattern, so Express returns default 404
      await request(app)
        .post('/message:unknown')
        .set('A2A-Version', '1.0')
        .send({ request: testMessage })
        .expect(404);
    });

    it('should return 404 for unknown task action (route not matched)', async () => {
      // Unknown actions don't match the route pattern, so Express returns default 404
      await request(app).post('/tasks/task-1:unknown').set('A2A-Version', '1.0').expect(404);
    });

    it('should handle internal server errors gracefully', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        new Error('Unexpected internal error')
      );

      const messageProto = ProtoMessage.toJSON(testMessage);
      const response = await request(app)
        .post('/message:send')
        .set('A2A-Version', '1.0')
        .send({ message: messageProto })
        .expect(500);

      assert.property(response.body, 'error');
      assert.property(response.body.error, 'message');
      assert.equal(response.body.error.code, 500);
    });
  });

  describe('A2A-Version header validation', () => {
    it('should reject header-less requests against a v1.0-only card when legacyCompat is omitted', async () => {
      // Without legacyCompat, the v1.0-only `testAgentCard` rejects
      // the §3.6.2 default-to-'0.3' because '0.3' is not declared in
      // `supportedInterfaces`. This is the strict-mode behavior; the
      // implicit-v0.3 acceptance is gated on opting into the compat
      // layer (see the `legacy v0.3 REST dispatch` block below).
      const response = await request(app).get('/tasks/task-1').expect(400);

      assert.property(response.body, 'error');
      assert.equal(response.body.error.details[0].reason, 'VERSION_NOT_SUPPORTED');
    });

    it('should accept requests with a supported A2A-Version header', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);

      await request(app).get('/tasks/task-1').set('A2A-Version', '1.0').expect(200);
    });

    it('should reject requests with an unsupported A2A-Version header', async () => {
      const response = await request(app)
        .get('/tasks/task-1')
        .set('A2A-Version', '9.9')
        .expect(400);

      assert.property(response.body, 'error');
      assert.equal(response.body.error.details[0].reason, 'VERSION_NOT_SUPPORTED');
      assert.include(response.body.error.message, '9.9');
    });

    it('should accept header-less requests against a v1.0-only card when legacyCompat is enabled', async () => {
      // With legacyCompat enabled, the validator implicitly accepts
      // the §3.6.2 default-to-'0.3' for any binding the card already
      // exposes, so a v0.3 client sending no header against a
      // v1.0-only `testAgentCard` is now accepted.
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);
      const compatApp = express();
      compatApp.use(
        restHandler({
          requestHandler: mockRequestHandler,
          userBuilder: UserBuilder.noAuthentication,
          legacyCompat: { enabled: true },
        })
      );

      await request(compatApp).get('/tasks/task-1').expect(200);
    });

    it('should accept explicit A2A-Version: 0.3 against a v1.0-only card when legacyCompat is enabled', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);
      const compatApp = express();
      compatApp.use(
        restHandler({
          requestHandler: mockRequestHandler,
          userBuilder: UserBuilder.noAuthentication,
          legacyCompat: { enabled: true },
        })
      );

      // /tasks/:taskId is a v1.0 path; the legacy router only owns
      // `/v1/...`, so the v1.0 router handles this request — but its
      // validator now accepts '0.3' under legacyCompat.
      await request(compatApp).get('/tasks/task-1').set('A2A-Version', '0.3').expect(200);
    });

    it('should still reject unsupported versions (e.g. 9.9) when legacyCompat is enabled', async () => {
      const compatApp = express();
      compatApp.use(
        restHandler({
          requestHandler: mockRequestHandler,
          userBuilder: UserBuilder.noAuthentication,
          legacyCompat: { enabled: true },
        })
      );

      const response = await request(compatApp)
        .get('/tasks/task-1')
        .set('A2A-Version', '9.9')
        .expect(400);

      assert.property(response.body, 'error');
      assert.equal(response.body.error.details[0].reason, 'VERSION_NOT_SUPPORTED');
    });
  });

  describe('Content-Type: application/a2a+json (§11.1)', () => {
    it('should return application/a2a+json for successful JSON responses', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);

      const response = await request(app)
        .get('/tasks/task-1')
        .set('A2A-Version', '1.0')
        .expect(200);

      assert.include(response.headers['content-type'], 'application/a2a+json');
    });

    it('should return application/a2a+json for error responses', async () => {
      const response = await request(app)
        .get('/tasks/task-1')
        .set('A2A-Version', '9.9')
        .expect(400);

      assert.include(response.headers['content-type'], 'application/a2a+json');
    });

    it('should accept requests with Content-Type application/a2a+json', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(testTask);

      const response = await request(app)
        .post('/message:send')
        .set('A2A-Version', '1.0')
        .set('Content-Type', 'application/a2a+json')
        .send(JSON.stringify({ message: testMessage }))
        .expect(200);

      assert.include(response.headers['content-type'], 'application/a2a+json');
    });

    it('should accept requests with Content-Type application/json', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);

      const response = await request(app)
        .get('/tasks/task-1')
        .set('A2A-Version', '1.0')
        .set('Content-Type', 'application/json')
        .expect(200);

      assert.include(response.headers['content-type'], 'application/a2a+json');
    });

    it('should return text/event-stream for SSE responses, not application/a2a+json', async () => {
      const streamResponse = (async function* () {
        yield { payload: { $case: 'task' as const, value: testTask } };
      })();

      (mockRequestHandler.sendMessageStream as Mock).mockReturnValue(streamResponse);

      const response = await request(app)
        .post('/message:stream')
        .set('A2A-Version', '1.0')
        .set('Accept', 'text/event-stream')
        .send({ message: testMessage })
        .expect(200);

      assert.include(response.headers['content-type'], 'text/event-stream');
    });
  });

  describe('legacy v0.3 REST dispatch', () => {
    // Agent card declaring both v1.0 and v0.3 HTTP+JSON interfaces so
    // version validation accepts requests from either path.
    const dualVersionAgentCard: AgentCard = {
      ...testAgentCard,
      supportedInterfaces: [
        {
          url: 'http://localhost:8080/v1',
          protocolBinding: 'HTTP+JSON',
          tenant: '',
          protocolVersion: '1.0',
        },
        {
          url: 'http://localhost:8080/v1',
          protocolBinding: 'HTTP+JSON',
          tenant: '',
          protocolVersion: '0.3',
        },
      ],
    };

    // Proto-JSON `SendMessageRequest` body — the wire shape the
    // v0.3 REST endpoint expects, per the v0.3 a2a.proto's
    // `google.api.http` annotation and matching what a2a-python's
    // REST handler accepts (NOT the legacy v0.3 JSON-RPC shape with
    // `kind` discriminators).
    const legacyMessageBody = {
      message: {
        messageId: 'msg-legacy-1',
        role: 'ROLE_USER',
        content: [{ text: 'hello' }],
      },
    };

    let legacySendMessageStub: MockInstance;
    let v1SendMessageStub: MockInstance;
    let dualApp: Express;

    beforeEach(() => {
      legacySendMessageStub = vi.spyOn(LegacyRestTransportHandler.prototype, 'sendMessage');
      v1SendMessageStub = mockRequestHandler.sendMessage as Mock as MockInstance;
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(dualVersionAgentCard);

      dualApp = express();
      dualApp.use(
        restHandler({
          requestHandler: mockRequestHandler,
          userBuilder: UserBuilder.noAuthentication,
          legacyCompat: { enabled: true },
        })
      );
    });

    it('routes POST /v1/message:send to the legacy handler', async () => {
      legacySendMessageStub.mockResolvedValue({
        kind: 'task',
        id: 'legacy-task-1',
        contextId: 'ctx',
        status: { state: 'working' },
      });

      const response = await request(dualApp)
        .post('/v1/message:send')
        .set('A2A-Version', '0.3')
        .send(legacyMessageBody)
        .expect(201);

      expect(legacySendMessageStub).toHaveBeenCalledTimes(1);
      expect(v1SendMessageStub).not.toHaveBeenCalled();
      // Proto-JSON `SendMessageResponse`: oneof `payload` flattens to
      // a top-level `task` (or `message`) field, no `kind` discriminator.
      assert.equal(response.body.task.id, 'legacy-task-1');
    });

    it('routes POST /message:send to the v1.0 handler', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue({
        ...testTask,
        id: 'v1-task-1',
      });

      const message = ProtoMessage.toJSON({
        ...testMessage,
        messageId: 'msg-v1-1',
        role: Role.ROLE_USER,
      });

      await request(dualApp)
        .post('/message:send')
        .set('A2A-Version', '1.0')
        .send({ message })
        .expect(200);

      expect(v1SendMessageStub).toHaveBeenCalledTimes(1);
      expect(legacySendMessageStub).not.toHaveBeenCalled();
    });

    it('accepts header-less requests on the legacy path (defaults to 0.3)', async () => {
      legacySendMessageStub.mockResolvedValue({
        kind: 'task',
        id: 'legacy-task-2',
        contextId: 'ctx',
        status: { state: 'working' },
      });

      // No A2A-Version header → defaults to A2A_LEGACY_PROTOCOL_VERSION
      // ('0.3'). The dual-version card declares v0.3 so validateVersion passes.
      await request(dualApp).post('/v1/message:send').send(legacyMessageBody).expect(201);

      expect(legacySendMessageStub).toHaveBeenCalledTimes(1);
    });

    it('accepts legacy requests against a v1.0-only card when legacyCompat is enabled', async () => {
      // Restore the v1.0-only card; with legacyCompat enabled, the
      // validator implicitly accepts the §3.6.2 default-to-'0.3' for
      // any binding the card already exposes — so the legacy router
      // handles the request even though the card declares no v0.3
      // HTTP+JSON interface.
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(testAgentCard);
      legacySendMessageStub.mockResolvedValue({
        kind: 'task',
        id: 'legacy-task-v1card',
        contextId: 'ctx',
        status: { state: 'working' },
      });

      const response = await request(dualApp)
        .post('/v1/message:send')
        .send(legacyMessageBody)
        .expect(201);

      // Proto-JSON response: task is nested under top-level `task` key.
      assert.equal(response.body.task.id, 'legacy-task-v1card');
      expect(legacySendMessageStub).toHaveBeenCalledTimes(1);
      expect(v1SendMessageStub).not.toHaveBeenCalled();
    });

    it('streams SSE responses on the legacy path', async () => {
      const legacyStream = (async function* () {
        yield {
          kind: 'task',
          id: 'legacy-stream-task',
          contextId: 'ctx',
          status: { state: 'working' },
        };
      })();
      vi.spyOn(LegacyRestTransportHandler.prototype, 'sendMessageStream').mockResolvedValue(
        legacyStream as any
      );

      const response = await request(dualApp)
        .post('/v1/message:stream')
        .send(legacyMessageBody)
        .expect(200);

      assert.include(response.headers['content-type'], 'text/event-stream');
      // SSE event body is proto-JSON of `StreamResponse`: the `task`
      // payload is nested under the oneof field name, with the inner
      // `Task` itself NOT carrying a `kind` discriminator.
      assert.include(response.text, '"task":{');
      assert.include(response.text, '"id":"legacy-stream-task"');
    });

    it('uses the legacy error mapper (bare body, no details[]) on legacy-path errors', async () => {
      legacySendMessageStub.mockRejectedValue(new GenericError('legacy boom'));

      const response = await request(dualApp)
        .post('/v1/message:send')
        .send(legacyMessageBody)
        .expect(500);

      assert.equal(response.body.code, -32603); // INTERNAL_ERROR
      assert.equal(response.body.message, 'legacy boom');
      // v0.3 body shape: bare {code, message, data?} — no details[], no
      // outer {error: {...}} wrapper, no status field.
      assert.notProperty(response.body, 'error');
      assert.notProperty(response.body, 'details');
      assert.notProperty(response.body, 'status');
    });

    it('does not invoke the legacy handler for GET /v1/tasks with A2A-Version: 1.0', async () => {
      // `/v1/tasks` has no exact match in the legacy router (only
      // `/v1/tasks/:taskId` is registered). With `A2A-Version: 1.0` the
      // version-dispatch middleware short-circuits BEFORE any legacy
      // route can match, falling through to the v1.0 router which then
      // matches `/:tenant/tasks` with `tenant='v1'` — exercising the
      // tenant-name reservation fix.
      const legacyListSpy = vi.spyOn(LegacyRestTransportHandler.prototype, 'getTask');
      (mockRequestHandler.listTasks as Mock).mockResolvedValue({ tasks: [], nextPageToken: '' });

      await request(dualApp).get('/v1/tasks').set('A2A-Version', '1.0');

      expect(legacyListSpy).not.toHaveBeenCalled();
      expect(mockRequestHandler.listTasks).toHaveBeenCalled();
    });

    it('sets Content-Type application/json on legacy responses', async () => {
      legacySendMessageStub.mockResolvedValue({
        kind: 'task',
        id: 'legacy-task-ct',
        contextId: 'ctx',
        status: { state: 'working' },
      });

      const response = await request(dualApp)
        .post('/v1/message:send')
        .send(legacyMessageBody)
        .expect(201);

      assert.include(response.headers['content-type'], 'application/json');
      assert.notInclude(response.headers['content-type'], 'application/a2a+json');
    });

    it('keeps Content-Type application/a2a+json on v1.0 responses', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(testTask);

      const response = await request(dualApp)
        .get('/tasks/task-1')
        .set('A2A-Version', '1.0')
        .expect(200);

      assert.include(response.headers['content-type'], 'application/a2a+json');
    });

    it('reads and writes back the legacy X-A2A-Extensions header', async () => {
      // Spy on sendMessage and have it record the activated extension
      // via the ServerCallContext, so we can assert the response header.
      legacySendMessageStub.mockImplementation(async (_params, context) => {
        context.addActivatedExtension('ext-1');
        return {
          kind: 'task',
          id: 'legacy-task-ext',
          contextId: 'ctx',
          status: { state: 'working' },
        };
      });

      const response = await request(dualApp)
        .post('/v1/message:send')
        .set('X-A2A-Extensions', 'ext-1')
        .send(legacyMessageBody)
        .expect(201);

      assert.equal(response.headers['x-a2a-extensions'], 'ext-1');
    });

    it('returns v1.0-shaped error for malformed JSON on v1.0 paths', async () => {
      // The legacy router's version-dispatch middleware short-circuits
      // requests with `A2A-Version: 1.0` (via `next('router')`) BEFORE
      // the legacy body parser runs. A malformed-JSON request to
      // `/message:send` with v1.0 must therefore yield the v1.0 error
      // envelope, not the bare v0.3 shape.
      const response = await request(dualApp)
        .post('/message:send')
        .set('A2A-Version', '1.0')
        .set('Content-Type', 'application/json')
        .send('{not valid json')
        .expect(400);

      // v1.0 envelope shape: { error: { code, status, message, details } }.
      assert.property(response.body, 'error');
      assert.equal(response.body.error.code, 400);
      assert.property(response.body.error, 'details');
      // v0.3 bare body fields must NOT appear at the top level.
      assert.notProperty(response.body, 'code');
      assert.notProperty(response.body, 'message');
    });

    it('returns v0.3-shaped error for malformed JSON on /v1/... paths', async () => {
      const response = await request(dualApp)
        .post('/v1/message:send')
        .set('Content-Type', 'application/json')
        .send('{not valid json')
        .expect(400);

      // v0.3 bare body shape: { code, message }.
      assert.equal(response.body.code, -32700); // PARSE_ERROR
      assert.property(response.body, 'message');
      assert.notProperty(response.body, 'error');
      assert.notProperty(response.body, 'details');
    });

    // ========================================================================
    // Opt-in flag matrix
    // ========================================================================

    it('rejects /v1/message:send when legacyCompat is omitted (flag default)', async () => {
      // Use a v1.0-only card so the v1.0 version validator cleanly rejects
      // header-less / 0.3-defaulted requests with a 400.
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(testAgentCard);
      const optOutApp = express();
      optOutApp.use(
        restHandler({
          requestHandler: mockRequestHandler,
          userBuilder: UserBuilder.noAuthentication,
          // legacyCompat omitted => disabled
        })
      );

      const response = await request(optOutApp)
        .post('/v1/message:send')
        .send(legacyMessageBody)
        .expect(400);

      // v1.0 envelope: the legacy compat layer is not instantiated, so
      // the request is rejected by the v1.0 version validator.
      assert.property(response.body, 'error');
      // Legacy code path is never invoked.
      expect(legacySendMessageStub).not.toHaveBeenCalled();
    });

    it('rejects /v1/message:send when legacyCompat.enabled is false', async () => {
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(testAgentCard);
      const optOutApp = express();
      optOutApp.use(
        restHandler({
          requestHandler: mockRequestHandler,
          userBuilder: UserBuilder.noAuthentication,
          legacyCompat: { enabled: false },
        })
      );

      const response = await request(optOutApp)
        .post('/v1/message:send')
        .send(legacyMessageBody)
        .expect(400);

      assert.property(response.body, 'error');
      expect(legacySendMessageStub).not.toHaveBeenCalled();
    });

    // ========================================================================
    // Tenant-collision regression
    // ========================================================================

    it("POST /v1/message:send with A2A-Version: 1.0 routes to v1.0 with tenant='v1'", async () => {
      // The headline win of the version-based dispatch: with the
      // legacy router mounted path-less, `/v1/...` is no longer a
      // reserved namespace. A v1.0 request to `/v1/message:send` is
      // matched by the v1.0 router's `/:tenant/message:send` route
      // with `tenant='v1'` (per v1.0 tenant semantics).
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue({
        ...testTask,
        id: 'v1-task-with-tenant',
      });

      const message = ProtoMessage.toJSON({
        ...testMessage,
        messageId: 'msg-tenant',
        role: Role.ROLE_USER,
      });

      await request(dualApp)
        .post('/v1/message:send')
        .set('A2A-Version', '1.0')
        .send({ message, tenant: 'v1' })
        .expect(200);

      expect(legacySendMessageStub).not.toHaveBeenCalled();
      expect(mockRequestHandler.sendMessage).toHaveBeenCalledTimes(1);
      const call = (mockRequestHandler.sendMessage as Mock).mock.calls[0][0];
      assert.equal(call.tenant, 'v1');
    });

    // ========================================================================
    // Version-range dispatch ([0.3, 1.0))
    // ========================================================================

    it('routes A2A-Version: 0.5 (in legacy range) to the legacy handler', async () => {
      // Card carries v0.3 but not v0.5; legacy router accepts the
      // dispatch by range but the version validator then rejects.
      const response = await request(dualApp)
        .post('/v1/message:send')
        .set('A2A-Version', '0.5')
        .send(legacyMessageBody)
        .expect(400);

      // v0.3 bare body shape: the legacy router handled it.
      assert.equal(response.body.code, -32009); // VERSION_NOT_SUPPORTED
      assert.notProperty(response.body, 'error');
      expect(legacySendMessageStub).not.toHaveBeenCalled();
    });

    it('routes A2A-Version: 2.0 (outside legacy range) to the v1.0 handler', async () => {
      // v1.0 router will reject because the card has no (HTTP+JSON, 2.0).
      const response = await request(dualApp)
        .post('/v1/message:send')
        .set('A2A-Version', '2.0')
        .send(legacyMessageBody)
        .expect(400);

      // v1.0 envelope: the v1.0 router handled the rejection.
      assert.property(response.body, 'error');
      expect(legacySendMessageStub).not.toHaveBeenCalled();
    });

    it('routes A2A-Version: foo (unparseable) to the v1.0 handler', async () => {
      const response = await request(dualApp)
        .post('/v1/message:send')
        .set('A2A-Version', 'foo')
        .send(legacyMessageBody)
        .expect(400);

      assert.property(response.body, 'error');
      expect(legacySendMessageStub).not.toHaveBeenCalled();
    });

    // ========================================================================
    // Extension-header tolerance on the legacy path
    // ========================================================================

    it('accepts the v1.0 A2A-Extensions header on the legacy path', async () => {
      // A v1.0-shaped client hitting a /v1 endpoint with the v1.0
      // header should still get its requested extension activated.
      legacySendMessageStub.mockImplementation(async (_params, context) => {
        context.addActivatedExtension('ext-modern');
        return {
          kind: 'task',
          id: 'legacy-task-modern-hdr',
          contextId: 'ctx',
          status: { state: 'working' },
        };
      });

      const response = await request(dualApp)
        .post('/v1/message:send')
        .set('A2A-Extensions', 'ext-modern')
        .send(legacyMessageBody)
        .expect(201);

      // Response always uses the v0.3 spelling on the legacy path.
      assert.equal(response.headers['x-a2a-extensions'], 'ext-modern');
    });

    it('prefers X-A2A-Extensions when both spellings are present', async () => {
      legacySendMessageStub.mockImplementation(async (_params, context) => {
        for (const ext of context.requestedExtensions ?? []) {
          context.addActivatedExtension(ext);
        }
        return {
          kind: 'task',
          id: 'legacy-task-both',
          contextId: 'ctx',
          status: { state: 'working' },
        };
      });

      const response = await request(dualApp)
        .post('/v1/message:send')
        .set('X-A2A-Extensions', 'legacy-ext')
        .set('A2A-Extensions', 'modern-ext')
        .send(legacyMessageBody)
        .expect(201);

      assert.equal(response.headers['x-a2a-extensions'], 'legacy-ext');
    });
  });
});

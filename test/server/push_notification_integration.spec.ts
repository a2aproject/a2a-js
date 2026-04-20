import { describe, it, beforeEach, afterEach, assert, vi, type MockInstance } from 'vitest';
import express, { Request, Response } from 'express';
import { Server } from 'http';
import { AddressInfo } from 'net';

import { DefaultRequestHandler } from '../../src/server/request_handler/default_request_handler.js';
import { InMemoryTaskStore } from '../../src/server/store.js';
import { InMemoryPushNotificationStore } from '../../src/server/push_notification/push_notification_store.js';
import { DefaultPushNotificationSender } from '../../src/server/push_notification/default_push_notification_sender.js';
import { DefaultExecutionEventBusManager } from '../../src/server/events/execution_event_bus_manager.js';
import {
  AgentCard,
  Message,
  TaskPushNotificationConfig,
  Task,
  Role,
  TaskState,
  TaskStatus,
  StreamResponse,
} from '../../src/types/pb/a2a.js';
import { SendMessageRequest } from '../../src/index.js';
import { ServerCallContext } from '../../src/server/context.js';
import { fakeTaskExecute, MockAgentExecutor } from './mocks/agent-executor.mock.js';
import { AgentEvent } from '../../src/server/events/execution_event_bus.js';

type PushNotificationSenderSpy = MockInstance<(streamResponse: StreamResponse) => Promise<void>>;

describe('Push Notification Integration Tests', () => {
  let testServer: Server;
  let testServerUrl: string;
  let receivedNotifications: Array<{
    body: any;
    headers: any;
    url: string;
    method: string;
  }> = [];

  let taskStore: InMemoryTaskStore;
  let handler: DefaultRequestHandler;
  let mockAgentExecutor: MockAgentExecutor;
  let pushNotificationStore: InMemoryPushNotificationStore;
  let pushNotificationSender: DefaultPushNotificationSender;
  let pushNotificationSenderSpy: PushNotificationSenderSpy;
  let defaultContext: ServerCallContext;

  const testAgentCard: AgentCard = {
    name: 'Test Agent',
    description: 'An agent for testing push notifications',
    version: '1.0.0',
    supportedInterfaces: [
      {
        url: 'http://localhost:8080',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extensions: [],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    provider: undefined,
    documentationUrl: '',
    securitySchemes: {},
    securityRequirements: [],
    signatures: [],
  };

  // Create test Express server to receive push notifications
  const createTestServer = (): Promise<{
    server: Server;
    port: number;
    url: string;
  }> => {
    return new Promise((resolve) => {
      const app = express();
      app.use(express.json());

      // Endpoint to receive push notifications
      app.post('/notify', (req: Request, res: Response) => {
        receivedNotifications.push({
          body: req.body,
          headers: req.headers,
          url: req.url,
          method: req.method,
        });
        res.status(200).json({ received: true, timestamp: new Date().toISOString() });
      });

      // Endpoint to simulate different response scenarios
      app.post('/notify/:scenario', async (req: Request, res: Response) => {
        const scenario = req.params.scenario;
        // Simulate delay for 'submitted' status to test correct ordering of notifications
        if (
          scenario === 'delay_on_submitted' &&
          req.body.task?.status?.state === 'TASK_STATE_SUBMITTED'
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        receivedNotifications.push({
          body: req.body,
          headers: req.headers,
          url: req.url,
          method: req.method,
        });

        switch (scenario) {
          case 'error':
            res.status(500).json({ error: 'Internal Server Error' });
            break;
          default:
            res.status(200).json({ received: true });
        }
      });

      const server = app.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        const url = `http://localhost:${port}`;
        resolve({ server, port, url });
      });
    });
  };

  beforeEach(async () => {
    // Reset state
    receivedNotifications = [];

    // Create and start test server
    const serverInfo = await createTestServer();
    testServer = serverInfo.server;
    testServerUrl = serverInfo.url;

    // Create fresh instances for each test
    taskStore = new InMemoryTaskStore();
    mockAgentExecutor = new MockAgentExecutor();
    const executionEventBusManager = new DefaultExecutionEventBusManager();
    pushNotificationStore = new InMemoryPushNotificationStore();
    pushNotificationSender = new DefaultPushNotificationSender(pushNotificationStore);
    pushNotificationSenderSpy = vi.spyOn(pushNotificationSender, 'send');
    defaultContext = new ServerCallContext();

    handler = new DefaultRequestHandler(
      testAgentCard,
      taskStore,
      mockAgentExecutor,
      executionEventBusManager,
      pushNotificationStore,
      pushNotificationSender
    );
  });

  afterEach(async () => {
    // Clean up test server
    if (testServer) {
      await testServer.close();
    }
    vi.restoreAllMocks();
  });

  const createTestMessage = (text: string, taskId?: string): Message => ({
    messageId: `msg-${Date.now()}`,
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: 'text', value: text },
        mediaType: 'text/plain',
        filename: '',
        metadata: {},
      },
    ],
    contextId: '',
    taskId: taskId || '',
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  });

  const waitForPushNotifications = async (spy: PushNotificationSenderSpy) => {
    await Promise.all(spy.mock.results.map((r) => r.value));
  };

  describe('End-to-End Push Notification Flow', () => {
    it('should send push notifications for task status updates', async () => {
      const pushConfig: TaskPushNotificationConfig = {
        tenant: '',
        taskId: '',
        id: 'test-push-config',
        url: `${testServerUrl}/notify/delay_on_submitted`,
        token: 'test-auth-token',
        authentication: undefined,
      };

      const contextId = 'test-push-context';
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          ...createTestMessage('Test task with push notifications'),
          contextId: contextId,
          extensions: [],
          metadata: {},
        },
        metadata: {},
        configuration: {
          taskPushNotificationConfig: pushConfig,
          historyLength: 0,
          returnImmediately: false,
          acceptedOutputModes: [],
        },
      };

      let taskId: string = '';
      // Mock the agent executor to publish all three states for this test only
      mockAgentExecutor.execute.mockImplementation(async (ctx, bus) => {
        taskId = ctx.taskId;
        await fakeTaskExecute(ctx, bus);
      });

      // Send message and wait for completion
      await handler.sendMessage(params, defaultContext);

      // Wait for async push notifications to be sent
      await waitForPushNotifications(pushNotificationSenderSpy);

      // Load the task from the store
      const expectedTaskResult: Task = {
        id: taskId,
        contextId,
        history: [params.message as Message],
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: undefined,
        } as TaskStatus,
        artifacts: [],
        metadata: {},
      };

      // Verify push notifications were sent
      assert.lengthOf(
        receivedNotifications,
        3,
        'Should send notifications for submitted, working, and completed states'
      );

      // Verify all three states are present
      const states = receivedNotifications.map(
        (n) => n.body.task?.status?.state || n.body.statusUpdate?.status?.state
      );
      assert.include(
        states,
        TaskState[TaskState.TASK_STATE_SUBMITTED],
        'Should include submitted state'
      );
      assert.include(
        states,
        TaskState[TaskState.TASK_STATE_WORKING],
        'Should include working state'
      );
      assert.include(
        states,
        TaskState[TaskState.TASK_STATE_COMPLETED],
        'Should include completed state'
      );

      // Verify first notification has correct format
      const firstNotification = receivedNotifications[0];
      assert.equal(firstNotification.method, 'POST');
      assert.equal(firstNotification.url, '/notify/delay_on_submitted');
      assert.equal(firstNotification.headers['content-type'], 'application/json');
      assert.equal(firstNotification.headers['x-a2a-notification-token'], 'test-auth-token');
      assert.deepEqual(
        firstNotification.body,
        StreamResponse.toJSON({
          payload: {
            $case: 'task',
            value: {
              ...expectedTaskResult,
              status: {
                state: TaskState.TASK_STATE_SUBMITTED,
                message: undefined,
                timestamp: undefined,
              },
            },
          },
        })
      );

      const secondNotification = receivedNotifications[1];
      assert.deepEqual(
        secondNotification.body,
        StreamResponse.toJSON({
          payload: {
            $case: 'statusUpdate',
            value: {
              taskId: taskId,
              contextId: contextId,
              status: {
                state: TaskState.TASK_STATE_WORKING,
                message: undefined,
                timestamp: undefined,
              },
              metadata: {},
            },
          },
        })
      );

      const thirdNotification = receivedNotifications[2];
      assert.deepEqual(
        thirdNotification.body,
        StreamResponse.toJSON({
          payload: {
            $case: 'statusUpdate',
            value: {
              taskId: taskId,
              contextId: contextId,
              status: {
                state: TaskState.TASK_STATE_COMPLETED,
                message: undefined,
                timestamp: undefined,
              },
              metadata: {},
            },
          },
        })
      );
    });

    it('should handle multiple push notification endpoints for the same task', async () => {
      const pushConfig1: TaskPushNotificationConfig = {
        tenant: '',
        taskId: 'test-multi-endpoints',
        id: 'config-1',
        url: `${testServerUrl}/notify`,
        token: 'token-1',
        authentication: undefined,
      };

      const pushConfig2: TaskPushNotificationConfig = {
        tenant: '',
        taskId: 'test-multi-endpoints',
        id: 'config-2',
        url: `${testServerUrl}/notify/second`,
        token: 'token-2',
        authentication: undefined,
      };

      const params: SendMessageRequest = {
        tenant: '',
        message: {
          ...createTestMessage('Test task with multiple push endpoints', 'test-multi-endpoints'),
          contextId: 'test-context',
          extensions: [],
          metadata: {},
        },
        metadata: {},
        configuration: undefined,
      };

      // Assume the task is created by a previous message
      const task: Task = {
        id: 'test-multi-endpoints',
        contextId: 'test-context',
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          message: undefined,
          timestamp: undefined,
        } as TaskStatus,
        history: [],
        artifacts: [],
        metadata: {},
      };
      await taskStore.save(task, defaultContext);

      // Set multiple push notification configs for this message
      await handler.createTaskPushNotificationConfig(pushConfig1, defaultContext);

      await handler.createTaskPushNotificationConfig(pushConfig2, defaultContext);

      // Mock the agent executor to publish only completed state
      mockAgentExecutor.execute.mockImplementation(async (ctx, bus) => {
        const taskId = ctx.taskId;
        const contextId = ctx.contextId;

        // Publish working status
        bus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_WORKING,
              message: undefined,
              timestamp: undefined,
            } as TaskStatus,
            metadata: {},
          })
        );

        // Publish completion directly
        bus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              message: undefined,
              timestamp: undefined,
            } as TaskStatus,
            metadata: {},
          })
        );

        bus.finished();
      });

      // Send a message to trigger notifications
      await handler.sendMessage(params, defaultContext);

      // Wait for async push notifications to be sent
      await waitForPushNotifications(pushNotificationSenderSpy);

      // Should now have notifications from both endpoints
      const notificationsByEndpoint = receivedNotifications.reduce(
        (acc, n) => {
          acc[n.url] = acc[n.url] || 0;
          acc[n.url]++;
          return acc;
        },
        {} as Record<string, number>
      );

      // Verify push notification was attempted (even though it failed)
      assert.lengthOf(receivedNotifications, 4, 'Should have 4 notifications 2 for each endpoint');
      assert.equal(
        notificationsByEndpoint['/notify'],
        2,
        'Should have 2 notifications for primary endpoint'
      );
      assert.equal(
        notificationsByEndpoint['/notify/second'],
        2,
        'Should have 2 notifications for second endpoint'
      );
    });

    it('should complete task successfully even when push notification endpoint returns an error', async () => {
      const pushConfig: TaskPushNotificationConfig = {
        tenant: '',
        taskId: '',
        id: 'error-endpoint-config',
        url: `${testServerUrl}/notify/error`,
        token: 'test-auth-token',
        authentication: undefined,
      };

      const contextId = 'test-error-context';
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          ...createTestMessage('Test task with error endpoint'),
          contextId: contextId,
          extensions: [],
          metadata: {},
        },
        metadata: {},
        configuration: {
          taskPushNotificationConfig: pushConfig,
          historyLength: 0,
          returnImmediately: false,
          acceptedOutputModes: [],
        },
      };

      let taskId: string = '';
      // Mock the agent executor to publish task states
      mockAgentExecutor.execute.mockImplementation(async (ctx, bus) => {
        taskId = ctx.taskId;
        fakeTaskExecute(ctx, bus);
      });

      // Send message and wait for completion - this should not throw an error
      const result = await handler.sendMessage(params, defaultContext);
      const taskResult = result as Task;

      // Wait for async push notifications to be sent
      await waitForPushNotifications(pushNotificationSenderSpy);

      // Load the task from the store
      const expectedTaskResult: Task = {
        id: taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: undefined,
        } as TaskStatus,
        history: [params.message as Message],
        artifacts: [],
        metadata: {},
      };

      // Verify the task payload requires loose matching for timestamps
      assert.equal(taskResult.id, expectedTaskResult.id);
      assert.equal(taskResult.status?.state, TaskState.TASK_STATE_COMPLETED);

      // Verify the error endpoint was hit
      const errorNotifications = receivedNotifications.filter((n) => n.url === '/notify/error');
      assert.lengthOf(
        errorNotifications,
        3,
        'Should have attempted to send notifications to error endpoint'
      );
    });
  });

  describe('Push Notification Header Configuration Tests', () => {
    it('should use default header name when tokenHeaderName is not specified', async () => {
      const pushConfig: TaskPushNotificationConfig = {
        tenant: '',
        taskId: '',
        id: 'default-header-test',
        url: `${testServerUrl}/notify`,
        token: 'default-token',
        authentication: undefined,
      };

      const params: SendMessageRequest = {
        tenant: '',
        message: createTestMessage('Test with default header name'),
        metadata: {},
        configuration: {
          taskPushNotificationConfig: pushConfig,
          historyLength: 0,
          returnImmediately: false,
          acceptedOutputModes: [],
        },
      };

      // Mock the agent executor to publish completion
      mockAgentExecutor.execute.mockImplementation(async (ctx, bus) => {
        const taskId = ctx.taskId;
        const contextId = ctx.contextId;

        bus.publish(
          AgentEvent.task({
            id: taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_SUBMITTED,
              message: undefined,
              timestamp: undefined,
            } as TaskStatus,
            artifacts: [],
            history: [],
            metadata: {},
          })
        );

        bus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              message: undefined,
              timestamp: undefined,
            } as TaskStatus,
            metadata: {},
          })
        );

        bus.finished();
      });

      await handler.sendMessage(params, defaultContext);

      // Wait for async push notifications to be sent
      await waitForPushNotifications(pushNotificationSenderSpy);

      // Verify default header name is used
      assert.lengthOf(
        receivedNotifications,
        2,
        'Should send notifications for submitted and completed states'
      );

      receivedNotifications.forEach((notification) => {
        assert.equal(
          notification.headers['x-a2a-notification-token'],
          'default-token',
          'Should use default header name X-A2A-Notification-Token'
        );
        assert.equal(
          notification.headers['content-type'],
          'application/json',
          'Should include content-type header'
        );
      });
    });

    it('should use custom header name when tokenHeaderName is specified', async () => {
      // Create a new handler with custom header name
      const customPushNotificationSender = new DefaultPushNotificationSender(
        pushNotificationStore,
        {
          tokenHeaderName: 'X-Custom-Auth-Token',
        }
      );
      const customSenderSpy = vi.spyOn(customPushNotificationSender, 'send');

      const customHandler = new DefaultRequestHandler(
        testAgentCard,
        taskStore,
        mockAgentExecutor,
        new DefaultExecutionEventBusManager(),
        pushNotificationStore,
        customPushNotificationSender
      );

      const pushConfig: TaskPushNotificationConfig = {
        tenant: '',
        taskId: '',
        id: 'custom-header-test',
        url: `${testServerUrl}/notify`,
        token: 'custom-token',
        authentication: undefined,
      };

      const params: SendMessageRequest = {
        tenant: '',
        message: createTestMessage('Test with custom header name'),
        metadata: {},
        configuration: {
          taskPushNotificationConfig: pushConfig,
          historyLength: 0,
          returnImmediately: false,
          acceptedOutputModes: [],
        },
      };

      // Mock the agent executor to publish completion
      mockAgentExecutor.execute.mockImplementation(async (ctx, bus) => {
        const taskId = ctx.taskId;
        const contextId = ctx.contextId;

        bus.publish(
          AgentEvent.task({
            id: taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_SUBMITTED,
              message: undefined,
              timestamp: undefined,
            } as TaskStatus,
            artifacts: [],
            history: [],
            metadata: {},
          })
        );

        bus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              message: undefined,
              timestamp: undefined,
            } as TaskStatus,
            metadata: {},
          })
        );

        bus.finished();
      });

      await customHandler.sendMessage(params, defaultContext);

      // Wait for async push notifications to be sent
      await waitForPushNotifications(customSenderSpy);

      // Verify custom header name is used
      assert.lengthOf(
        receivedNotifications,
        2,
        'Should send notifications for submitted and completed states'
      );

      receivedNotifications.forEach((notification) => {
        assert.equal(
          notification.headers['x-custom-auth-token'],
          'custom-token',
          'Should use custom header name X-Custom-Auth-Token'
        );
        assert.isUndefined(
          notification.headers['x-a2a-notification-token'],
          'Should not use default header name'
        );
        assert.equal(
          notification.headers['content-type'],
          'application/json',
          'Should include content-type header'
        );
      });
    });

    it('should not send token header when token is not provided', async () => {
      const pushConfig: TaskPushNotificationConfig = {
        tenant: '',
        taskId: '',
        id: 'no-token-test',
        url: `${testServerUrl}/notify`,
        token: '', // Empty token
        authentication: undefined,
      };

      const params: SendMessageRequest = {
        tenant: '',
        message: createTestMessage('Test without token'),
        metadata: {},
        configuration: {
          taskPushNotificationConfig: pushConfig,
          historyLength: 0,
          returnImmediately: false,
          acceptedOutputModes: [],
        },
      };

      // Mock the agent executor to publish completion
      mockAgentExecutor.execute.mockImplementation(async (ctx, bus) => {
        const taskId = ctx.taskId;
        const contextId = ctx.contextId;

        bus.publish(
          AgentEvent.task({
            id: taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_SUBMITTED,
              message: undefined,
              timestamp: undefined,
            } as TaskStatus,
            artifacts: [],
            history: [],
            metadata: {},
          })
        );

        bus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              message: undefined,
              timestamp: undefined,
            } as TaskStatus,
            metadata: {},
          })
        );

        bus.finished();
      });

      await handler.sendMessage(params, defaultContext);

      // Wait for async push notifications to be sent
      await waitForPushNotifications(pushNotificationSenderSpy);

      // Verify no token header is sent
      assert.lengthOf(
        receivedNotifications,
        2,
        'Should send notifications for submitted and completed states'
      );

      receivedNotifications.forEach((notification) => {
        assert.isUndefined(
          notification.headers['x-a2a-notification-token'],
          'Should not include token header when token is not provided'
        );
        assert.equal(
          notification.headers['content-type'],
          'application/json',
          'Should include content-type header'
        );
      });
    });

    it('should handle multiple push configs with different header configurations', async () => {
      // Create a handler with custom header name
      const customPushNotificationSender = new DefaultPushNotificationSender(
        pushNotificationStore,
        {
          tokenHeaderName: 'X-Custom-Token',
        }
      );
      const customSenderSpy = vi.spyOn(customPushNotificationSender, 'send');

      const customHandler = new DefaultRequestHandler(
        testAgentCard,
        taskStore,
        mockAgentExecutor,
        new DefaultExecutionEventBusManager(),
        pushNotificationStore,
        customPushNotificationSender
      );

      const pushConfig1: TaskPushNotificationConfig = {
        tenant: '',
        taskId: 'multi-config-test',
        id: 'config-with-token',
        url: `${testServerUrl}/notify`,
        token: 'token-1',
        authentication: undefined,
      };

      const pushConfig2: TaskPushNotificationConfig = {
        tenant: '',
        taskId: 'multi-config-test',
        id: 'config-without-token',
        url: `${testServerUrl}/notify/second`,
        token: '',
        authentication: undefined,
      };

      const params: SendMessageRequest = {
        tenant: '',
        message: {
          ...createTestMessage('Test with multiple configs', 'multi-config-test'),
          contextId: 'test-context',
          extensions: [],
          metadata: {},
        },
        metadata: {},
        configuration: undefined,
      };

      // Create task and set multiple push configs
      const task: Task = {
        id: 'multi-config-test',
        contextId: 'test-context',
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          message: undefined,
          timestamp: undefined,
        } as TaskStatus,
        history: [],
        artifacts: [],
        metadata: {},
      };
      await taskStore.save(task, defaultContext);

      await customHandler.createTaskPushNotificationConfig(pushConfig1, defaultContext);

      await customHandler.createTaskPushNotificationConfig(pushConfig2, defaultContext);

      // Mock the agent executor to publish completion
      mockAgentExecutor.execute.mockImplementation(async (ctx, bus) => {
        const taskId = ctx.taskId;
        const contextId = ctx.contextId;

        bus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              message: undefined,
              timestamp: undefined,
            } as TaskStatus,
            metadata: {},
          })
        );

        bus.finished();
      });

      await customHandler.sendMessage(params, defaultContext);

      // Wait for async push notifications to be sent
      await waitForPushNotifications(customSenderSpy);

      // Verify both endpoints received notifications with correct headers
      const config1Notifications = receivedNotifications.filter((n) => n.url === '/notify');
      const config2Notifications = receivedNotifications.filter((n) => n.url === '/notify/second');

      assert.lengthOf(config1Notifications, 1, 'Should send notification to first endpoint');
      assert.lengthOf(config2Notifications, 1, 'Should send notification to second endpoint');

      // Check headers for config with token
      config1Notifications.forEach((notification) => {
        assert.equal(
          notification.headers['x-custom-token'],
          'token-1',
          'Should use custom header name for config with token'
        );
        assert.isUndefined(
          notification.headers['x-a2a-notification-token'],
          'Should not use default header name'
        );
      });

      // Check headers for config without token
      config2Notifications.forEach((notification) => {
        assert.isUndefined(
          notification.headers['x-custom-token'],
          'Should not include token header for config without token'
        );
        assert.isUndefined(
          notification.headers['x-a2a-notification-token'],
          'Should not include default token header'
        );
      });

      // Both should have content-type
      receivedNotifications.forEach((notification) => {
        assert.equal(
          notification.headers['content-type'],
          'application/json',
          'Should include content-type header'
        );
      });
    });
  });

  describe('StreamResponse payload types', () => {
    it('should throw if tried to send message payload', async () => {
      const taskId = 'test-message-payload';
      const pushConfig: TaskPushNotificationConfig = {
        tenant: '',
        taskId,
        id: 'config-message',
        url: `${testServerUrl}/notify`,
        token: 'test-token',
        authentication: undefined,
      };
      await pushNotificationStore.save(taskId, defaultContext, pushConfig);

      const streamResponse: StreamResponse = {
        payload: {
          $case: 'message',
          value: {
            messageId: 'msg-123',
            taskId,
            role: Role.ROLE_AGENT,
            parts: [
              {
                content: { $case: 'text', value: 'Hello' },
                filename: '',
                mediaType: 'text/plain',
                metadata: {},
              },
            ],
            contextId: 'ctx-123',
            extensions: [],
            metadata: {},
            referenceTaskIds: [],
          },
        },
      };

      let threw = false;
      try {
        await pushNotificationSender.send(streamResponse, defaultContext);
      } catch (error: any) {
        threw = true;
        assert.include(error.message, 'Push notification should not be sent for message payload');
      }
      assert.isTrue(threw, 'Should have thrown an error');

      // Verify no notifications were sent
      assert.equal(receivedNotifications.length, 0);
    });

    it('should send statusUpdate payload correctly', async () => {
      const taskId = 'test-status-payload';
      const pushConfig: TaskPushNotificationConfig = {
        tenant: '',
        taskId,
        id: 'config-status',
        url: `${testServerUrl}/notify`,
        token: 'test-token',
        authentication: undefined,
      };
      await pushNotificationStore.save(taskId, defaultContext, pushConfig);

      const streamResponse: StreamResponse = {
        payload: {
          $case: 'statusUpdate',
          value: {
            taskId,
            contextId: 'ctx-123',
            status: {
              state: TaskState.TASK_STATE_WORKING,
              message: undefined,
              timestamp: '2026-04-15T14:00:00Z',
            },
            metadata: {},
          },
        },
      };

      await pushNotificationSender.send(streamResponse, defaultContext);

      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.equal(receivedNotifications.length, 1);
      const notification = receivedNotifications[0];
      assert.deepEqual(notification.body, StreamResponse.toJSON(streamResponse));
    });

    it('should send artifactUpdate payload correctly', async () => {
      const taskId = 'test-artifact-payload';
      const pushConfig: TaskPushNotificationConfig = {
        tenant: '',
        taskId,
        id: 'config-artifact',
        url: `${testServerUrl}/notify`,
        token: 'test-token',
        authentication: undefined,
      };
      await pushNotificationStore.save(taskId, defaultContext, pushConfig);

      const streamResponse: StreamResponse = {
        payload: {
          $case: 'artifactUpdate',
          value: {
            taskId,
            contextId: 'ctx-123',
            artifact: {
              artifactId: 'art-123',
              name: 'test.txt',
              description: 'A test artifact',
              parts: [
                {
                  content: { $case: 'text', value: 'Artifact content' },
                  filename: 'test.txt',
                  mediaType: 'text/plain',
                  metadata: {},
                },
              ],
              metadata: {},
              extensions: [],
            },
            append: false,
            lastChunk: true,
            metadata: {},
          },
        },
      };

      await pushNotificationSender.send(streamResponse, defaultContext);

      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.equal(receivedNotifications.length, 1);
      const notification = receivedNotifications[0];
      assert.deepEqual(notification.body, StreamResponse.toJSON(streamResponse));
    });
  });
});

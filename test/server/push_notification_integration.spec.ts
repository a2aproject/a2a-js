import 'mocha';
import { assert } from 'chai';
import sinon from 'sinon';
import express, { Request, Response } from 'express';
import { Server } from 'http';
import { AddressInfo } from 'net';

import { DefaultRequestHandler } from '../../src/server/request_handler/default_request_handler.js';
import { InMemoryTaskStore } from '../../src/server/store.js';
import { InMemoryPushNotificationStore } from '../../src/server/push_notification/push_notification_store.js';
import { DefaultPushNotificationSender } from '../../src/server/push_notification/default_push_notification_sender.js';
import { DefaultExecutionEventBusManager } from '../../src/server/events/execution_event_bus_manager.js';
import { AgentCard, Message, MessageSendParams, PushNotificationConfig, Task } from '../../src/index.js';
import { fakeTaskExecute, MockAgentExecutor } from './mocks/agent-executor.mock.js';

describe('Push Notification Integration Tests', () => {
    let testServer: Server;
    let testServerUrl: string;
    let receivedNotifications: Array<{ body: any; headers: any; url: string; method: string }> = [];
    
    let taskStore: InMemoryTaskStore;
    let handler: DefaultRequestHandler;
    let mockAgentExecutor: MockAgentExecutor;
    let pushNotificationStore: InMemoryPushNotificationStore;
    let pushNotificationSender: DefaultPushNotificationSender;

    const testAgentCard: AgentCard = {
        name: 'Test Agent',
        description: 'An agent for testing push notifications',
        url: 'http://localhost:8080',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: {
            streaming: true,
            pushNotifications: true,
        },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [],
    };

    // Create test Express server to receive push notifications
    const createTestServer = (): Promise<{ server: Server; port: number; url: string }> => {
        return new Promise((resolve) => {
            const app = express();
            app.use(express.json());

            // Endpoint to receive push notifications
            app.post('/notify', (req: Request, res: Response) => {
                receivedNotifications.push({
                    body: req.body,
                    headers: req.headers,
                    url: req.url,
                    method: req.method
                });
                res.status(200).json({ received: true, timestamp: new Date().toISOString() });
            });

            // Endpoint to simulate different response scenarios
            app.post('/notify/:scenario', async (req: Request, res: Response) => {
                const scenario = req.params.scenario;
                // Simulate delay for 'submitted' status to test correct ordering of notifications
                if (scenario === 'delay_on_submitted' && req.body.status.state === 'submitted') {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }

                receivedNotifications.push({
                    body: req.body,
                    headers: req.headers,
                    url: req.url,
                    method: req.method
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

        handler = new DefaultRequestHandler(
            testAgentCard,
            taskStore,
            mockAgentExecutor,
            executionEventBusManager,
            pushNotificationStore,
            pushNotificationSender,
        );
    });

    afterEach(async () => {
        // Clean up test server
        if (testServer) {
           await testServer.close();
        }
        sinon.restore();
    });

    const createTestMessage = (text: string, taskId?: string): Message => ({
        messageId: `msg-${Date.now()}`,
        role: 'user',
        parts: [{ kind: 'text', text }],
        kind: 'message',
        ...(taskId && { taskId })
    });

    describe('End-to-End Push Notification Flow', () => {
        it('should send push notifications for task status updates', async () => {
            const pushConfig: PushNotificationConfig = {
                id: 'test-push-config',
                url: `${testServerUrl}/notify/delay_on_submitted`,
                token: 'test-auth-token'
            };

            const contextId = 'test-push-context';
            const params: MessageSendParams = {
                message: {
                    ...createTestMessage('Test task with push notifications'),
                    contextId: contextId,
                },
                configuration: {
                    pushNotificationConfig: pushConfig
                }
            };

            let taskId: string;
            // Mock the agent executor to publish all three states for this test only
            mockAgentExecutor.execute.callsFake(async (ctx, bus) => {
                taskId = ctx.taskId;
                fakeTaskExecute(ctx, bus);
            });

            // Send message and wait for completion
            await handler.sendMessage(params);

            // Wait for async push notifications to be sent
            await new Promise(resolve => setTimeout(resolve, 200));

            // Load the task from the store
            const expectedTaskResult: Task = {
                id: taskId,
                contextId,
                history: [params.message as Message],
                status: { state: 'completed' },
                kind: 'task'
            };

            // Verify push notifications were sent
            assert.lengthOf(receivedNotifications, 3, 'Should send notifications for submitted, working, and completed states');
            
            // Verify all three states are present
            const states = receivedNotifications.map(n => n.body.status.state);
            assert.include(states, 'submitted', 'Should include submitted state');
            assert.include(states, 'working', 'Should include working state');
            assert.include(states, 'completed', 'Should include completed state');
            
            // Verify first notification has correct format
            const firstNotification = receivedNotifications[0];
            assert.equal(firstNotification.method, 'POST');
            assert.equal(firstNotification.url, '/notify/delay_on_submitted');
            assert.equal(firstNotification.headers['content-type'], 'application/json');
            assert.equal(firstNotification.headers['x-a2a-notification-token'], 'test-auth-token');
            assert.deepEqual(firstNotification.body, {
                ...expectedTaskResult,
                status: { state: 'submitted' }
            });

            const secondNotification = receivedNotifications[1];
            assert.deepEqual(secondNotification.body, {
                ...expectedTaskResult,
                status: { state: 'working' }
            });

            const thirdNotification = receivedNotifications[2];
            assert.deepEqual(thirdNotification.body, {
                ...expectedTaskResult,
                status: { state: 'completed' }
            });
        });

        it('should handle multiple push notification endpoints for the same task', async () => {
            const pushConfig1: PushNotificationConfig = {
                id: 'config-1',
                url: `${testServerUrl}/notify`,
                token: 'token-1'
            };
            
            const pushConfig2: PushNotificationConfig = {
                id: 'config-2',
                url: `${testServerUrl}/notify/second`,
                token: 'token-2'
            };

            const params: MessageSendParams = {
                message: {
                    ...createTestMessage('Test task with multiple push endpoints'),
                    taskId: 'test-multi-endpoints',
                    contextId: 'test-context'
                }
            };

            // Assume the task is created by a previous message
            const task: Task = {
                id: 'test-multi-endpoints',
                contextId: 'test-context',
                status: { state: 'submitted' },
                kind: 'task'
            };
            await taskStore.save(task);

            // Set multiple push notification configs for this message
            await handler.setTaskPushNotificationConfig({
                taskId: task.id,
                pushNotificationConfig: pushConfig1
            });

            await handler.setTaskPushNotificationConfig({
                taskId: task.id,
                pushNotificationConfig: pushConfig2
            });

            // Mock the agent executor to publish only completed state
            mockAgentExecutor.execute.callsFake(async (ctx, bus) => {
                const taskId = ctx.taskId;
                const contextId = ctx.contextId;
                
                // Publish working status
                bus.publish({ 
                    id: taskId, 
                    contextId, 
                    status: { state: "working" }, 
                    kind: 'task' 
                });
                
                // Publish completion directly
                bus.publish({ 
                    taskId, 
                    contextId, 
                    kind: 'status-update', 
                    status: { state: "completed" }, 
                    final: true 
                });
                
                bus.finished();
            });

            // Send a message to trigger notifications
            await handler.sendMessage(params);

            // Wait for async push notifications to be sent
            await new Promise(resolve => setTimeout(resolve, 300));

            // Should now have notifications from both endpoints
            const notificationsByEndpoint = receivedNotifications.reduce((acc, n) => {
                acc[n.url] = acc[n.url] || 0;
                acc[n.url]++;
                return acc;
            }, {} as Record<string, number>);

            // Verify push notification was attempted (even though it failed)
            assert.lengthOf(receivedNotifications, 4, 'Should have 4 notifications 2 for each endpoint');
            assert.equal(notificationsByEndpoint['/notify'], 2, 'Should have 2 notifications for primary endpoint');
            assert.equal(notificationsByEndpoint['/notify/second'], 2, 'Should have 2 notifications for second endpoint');
        });

        it('should complete task successfully even when push notification endpoint returns an error', async () => {
            const pushConfig: PushNotificationConfig = {
                id: 'error-endpoint-config',
                url: `${testServerUrl}/notify/error`,
                token: 'test-auth-token'
            };

            const  contextId = 'test-error-context';
            const params: MessageSendParams = {
                message: {
                    ...createTestMessage('Test task with error endpoint'),
                    contextId: contextId,
                },
                configuration: {
                    pushNotificationConfig: pushConfig
                }
            };

            let taskId: string;
            // Mock the agent executor to publish task states
            mockAgentExecutor.execute.callsFake(async (ctx, bus) => {
                taskId = ctx.taskId;
                fakeTaskExecute(ctx, bus);
            });

            // Send message and wait for completion - this should not throw an error
            const result = await handler.sendMessage(params);
            const task = result as Task;

            // Wait for async push notifications to be sent
            await new Promise(resolve => setTimeout(resolve, 200));

            // Load the task from the store
            const expectedTaskResult: Task = {
                id: taskId,
                contextId,
                history: [params.message as Message],
                status: { state: 'completed' },
                kind: 'task'
            };

            // Verify the task payload
            assert.deepEqual(task, expectedTaskResult);
            
            // Verify the error endpoint was hit
            const errorNotifications = receivedNotifications.filter(n => n.url === '/notify/error');
            assert.lengthOf(errorNotifications, 3, 'Should have attempted to send notifications to error endpoint');
        });
    });

    describe('Push Notification Header Configuration Tests', () => {
        it('should use default header name when tokenHeaderName is not specified', async () => {
            const pushConfig: PushNotificationConfig = {
                id: 'default-header-test',
                url: `${testServerUrl}/notify`,
                token: 'default-token'
            };

            const params: MessageSendParams = {
                message: createTestMessage('Test with default header name'),
                configuration: {
                    pushNotificationConfig: pushConfig
                }
            };

            // Mock the agent executor to publish completion
            mockAgentExecutor.execute.callsFake(async (ctx, bus) => {
                const taskId = ctx.taskId;
                const contextId = ctx.contextId;
                
                bus.publish({ 
                    id: taskId, 
                    contextId, 
                    status: { state: "submitted" }, 
                    kind: 'task' 
                });
                
                bus.publish({ 
                    taskId, 
                    contextId, 
                    kind: 'status-update', 
                    status: { state: "completed" }, 
                    final: true 
                });
                
                bus.finished();
            });

            await handler.sendMessage(params);

            // Wait for async push notifications to be sent
            await new Promise(resolve => setTimeout(resolve, 200));

            // Verify default header name is used
            assert.lengthOf(receivedNotifications, 2, 'Should send notifications for submitted and completed states');
            
            receivedNotifications.forEach(notification => {
                assert.equal(notification.headers['x-a2a-notification-token'], 'default-token', 
                    'Should use default header name X-A2A-Notification-Token');
                assert.equal(notification.headers['content-type'], 'application/json', 
                    'Should include content-type header');
            });
        });

        it('should use custom header name when tokenHeaderName is specified', async () => {
            // Create a new handler with custom header name
            const customPushNotificationSender = new DefaultPushNotificationSender(
                pushNotificationStore, 
                { tokenHeaderName: 'X-Custom-Auth-Token' }
            );
            
            const customHandler = new DefaultRequestHandler(
                testAgentCard,
                taskStore,
                mockAgentExecutor,
                new DefaultExecutionEventBusManager(),
                pushNotificationStore,
                customPushNotificationSender,
            );

            const pushConfig: PushNotificationConfig = {
                id: 'custom-header-test',
                url: `${testServerUrl}/notify`,
                token: 'custom-token'
            };

            const params: MessageSendParams = {
                message: createTestMessage('Test with custom header name'),
                configuration: {
                    pushNotificationConfig: pushConfig
                }
            };

            // Mock the agent executor to publish completion
            mockAgentExecutor.execute.callsFake(async (ctx, bus) => {
                const taskId = ctx.taskId;
                const contextId = ctx.contextId;
                
                bus.publish({ 
                    id: taskId, 
                    contextId, 
                    status: { state: "submitted" }, 
                    kind: 'task' 
                });
                
                bus.publish({ 
                    taskId, 
                    contextId, 
                    kind: 'status-update', 
                    status: { state: "completed" }, 
                    final: true 
                });
                
                bus.finished();
            });

            await customHandler.sendMessage(params);

            // Wait for async push notifications to be sent
            await new Promise(resolve => setTimeout(resolve, 200));

            // Verify custom header name is used
            assert.lengthOf(receivedNotifications, 2, 'Should send notifications for submitted and completed states');
            
            receivedNotifications.forEach(notification => {
                assert.equal(notification.headers['x-custom-auth-token'], 'custom-token', 
                    'Should use custom header name X-Custom-Auth-Token');
                assert.isUndefined(notification.headers['x-a2a-notification-token'], 
                    'Should not use default header name');
                assert.equal(notification.headers['content-type'], 'application/json', 
                    'Should include content-type header');
            });
        });

        it('should not send token header when token is not provided', async () => {
            const pushConfig: PushNotificationConfig = {
                id: 'no-token-test',
                url: `${testServerUrl}/notify`
                // No token provided
            };

            const params: MessageSendParams = {
                message: createTestMessage('Test without token'),
                configuration: {
                    pushNotificationConfig: pushConfig
                }
            };

            // Mock the agent executor to publish completion
            mockAgentExecutor.execute.callsFake(async (ctx, bus) => {
                const taskId = ctx.taskId;
                const contextId = ctx.contextId;
                
                bus.publish({ 
                    id: taskId, 
                    contextId, 
                    status: { state: "submitted" }, 
                    kind: 'task' 
                });
                
                bus.publish({ 
                    taskId, 
                    contextId, 
                    kind: 'status-update', 
                    status: { state: "completed" }, 
                    final: true 
                });
                
                bus.finished();
            });

            await handler.sendMessage(params);

            // Wait for async push notifications to be sent
            await new Promise(resolve => setTimeout(resolve, 200));

            // Verify no token header is sent
            assert.lengthOf(receivedNotifications, 2, 'Should send notifications for submitted and completed states');
            
            receivedNotifications.forEach(notification => {
                assert.isUndefined(notification.headers['x-a2a-notification-token'], 
                    'Should not include token header when token is not provided');
                assert.equal(notification.headers['content-type'], 'application/json', 
                    'Should include content-type header');
            });
        });

        it('should handle multiple push configs with different header configurations', async () => {
            // Create a handler with custom header name
            const customPushNotificationSender = new DefaultPushNotificationSender(
                pushNotificationStore, 
                { tokenHeaderName: 'X-Custom-Token' }
            );
            
            const customHandler = new DefaultRequestHandler(
                testAgentCard,
                taskStore,
                mockAgentExecutor,
                new DefaultExecutionEventBusManager(),
                pushNotificationStore,
                customPushNotificationSender,
            );

            const pushConfig1: PushNotificationConfig = {
                id: 'config-with-token',
                url: `${testServerUrl}/notify`,
                token: 'token-1'
            };

            const pushConfig2: PushNotificationConfig = {
                id: 'config-without-token',
                url: `${testServerUrl}/notify/second`
                // No token
            };

            const params: MessageSendParams = {
                message: {
                    ...createTestMessage('Test with multiple configs'),
                    taskId: 'multi-config-test',
                    contextId: 'test-context'
                }
            };

            // Create task and set multiple push configs
            const task: Task = {
                id: 'multi-config-test',
                contextId: 'test-context',
                status: { state: 'submitted' },
                kind: 'task'
            };
            await taskStore.save(task);

            await customHandler.setTaskPushNotificationConfig({
                taskId: task.id,
                pushNotificationConfig: pushConfig1
            });

            await customHandler.setTaskPushNotificationConfig({
                taskId: task.id,
                pushNotificationConfig: pushConfig2
            });

            // Mock the agent executor to publish completion
            mockAgentExecutor.execute.callsFake(async (ctx, bus) => {
                const taskId = ctx.taskId;
                const contextId = ctx.contextId;
                
                bus.publish({ 
                    taskId, 
                    contextId, 
                    kind: 'status-update', 
                    status: { state: "completed" }, 
                    final: true 
                });
                
                bus.finished();
            });

            await customHandler.sendMessage(params);

            // Wait for async push notifications to be sent
            await new Promise(resolve => setTimeout(resolve, 300));

            // Verify both endpoints received notifications with correct headers
            const config1Notifications = receivedNotifications.filter(n => n.url === '/notify');
            const config2Notifications = receivedNotifications.filter(n => n.url === '/notify/second');

            assert.lengthOf(config1Notifications, 1, 'Should send notification to first endpoint');
            assert.lengthOf(config2Notifications, 1, 'Should send notification to second endpoint');

            // Check headers for config with token
            config1Notifications.forEach(notification => {
                assert.equal(notification.headers['x-custom-token'], 'token-1', 
                    'Should use custom header name for config with token');
                assert.isUndefined(notification.headers['x-a2a-notification-token'], 
                    'Should not use default header name');
            });

            // Check headers for config without token
            config2Notifications.forEach(notification => {
                assert.isUndefined(notification.headers['x-custom-token'], 
                    'Should not include token header for config without token');
                assert.isUndefined(notification.headers['x-a2a-notification-token'], 
                    'Should not include default token header');
            });

            // Both should have content-type
            receivedNotifications.forEach(notification => {
                assert.equal(notification.headers['content-type'], 'application/json', 
                    'Should include content-type header');
            });
        });
    });
});

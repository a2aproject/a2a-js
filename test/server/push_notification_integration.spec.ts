import 'mocha';
import { assert, expect } from 'chai';
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
import { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';
import { RequestContext } from '../../src/server/agent_execution/request_context.js';
import { ExecutionEventBus } from '../../src/server/events/execution_event_bus.js';

describe('Push Notification Integration Tests', () => {
    let testServer: Server;
    let testServerPort: number;
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

    // Mock AgentExecutor following the pattern from default_request_handler.spec.ts
    class MockAgentExecutor implements AgentExecutor {
        // Stubs to control and inspect calls to execute
        public execute: sinon.SinonStub<
            [RequestContext, ExecutionEventBus],
            Promise<void>
        > = sinon.stub();
        
        public cancelTask: sinon.SinonStub<
            [string, ExecutionEventBus],
            Promise<void>
        > = sinon.stub();
    }

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
            app.post('/notify/:scenario', (req: Request, res: Response) => {
                const scenario = req.params.scenario;
                
                receivedNotifications.push({
                    body: req.body,
                    headers: req.headers,
                    url: req.url,
                    method: req.method
                });

                switch (scenario) {
                    case 'slow':
                        setTimeout(() => res.status(200).json({ received: true }), 50);
                        break;
                    case 'error':
                        res.status(500).json({ error: 'Internal Server Error' });
                        break;
                    case 'unauthorized':
                        res.status(401).json({ error: 'Unauthorized' });
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
        testServerPort = serverInfo.port;
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
            await new Promise<void>((resolve) => {
                testServer.close(() => resolve());
            });
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
                url: `${testServerUrl}/notify`,
                token: 'test-auth-token'
            };

            const params: MessageSendParams = {
                message: createTestMessage('Test task with push notifications'),
                configuration: {
                    pushNotificationConfig: pushConfig
                }
            };

            // Mock the agent executor to publish all three states for this test only
            mockAgentExecutor.execute.callsFake(async (ctx, bus) => {
                const taskId = ctx.taskId;
                const contextId = ctx.contextId;
                
                // Publish task creation
                bus.publish({ 
                    id: taskId, 
                    contextId, 
                    status: { state: "submitted" }, 
                    kind: 'task' 
                });
                
                // Publish working status
                bus.publish({ 
                    taskId, 
                    contextId, 
                    kind: 'status-update', 
                    status: { state: "working" }, 
                    final: false 
                });
                
                // Publish completion
                bus.publish({ 
                    taskId, 
                    contextId, 
                    kind: 'status-update', 
                    status: { state: "completed" }, 
                    final: true 
                });
                
                bus.finished();
            });

            // Send message and wait for completion
            const result = await handler.sendMessage(params);
            const task = result as Task;

            // Wait for async push notifications to be sent
            await new Promise(resolve => setTimeout(resolve, 200));

            // Verify push notifications were sent
            assert.lengthOf(receivedNotifications, 3, 'Should send notifications for submitted, working, and completed states');
            
            // Verify all three states are present (order may vary)
            const states = receivedNotifications.map(n => n.body.status.state);
            assert.include(states, 'submitted', 'Should include submitted state');
            assert.include(states, 'working', 'Should include working state');
            assert.include(states, 'completed', 'Should include completed state');
            
            // Verify first notification has correct format
            const firstNotification = receivedNotifications[0];
            assert.equal(firstNotification.method, 'POST');
            assert.equal(firstNotification.url, '/notify');
            assert.equal(firstNotification.headers['content-type'], 'application/json');
            assert.equal(firstNotification.headers['x-a2a-notification-token'], 'test-auth-token');
            assert.equal(firstNotification.body.id, task.id);
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
            const allEndpoints = receivedNotifications.map(n => n.url);
            assert.include(allEndpoints, '/notify', 'Should notify primary endpoint');
            assert.include(allEndpoints, '/notify/second', 'Should notify second endpoint');
        });

        it('should handle slow push notification endpoints gracefully', async () => {
            const slowConfig: PushNotificationConfig = {
                id: 'slow-config',
                url: `${testServerUrl}/notify/slow`,
                token: 'slow-token'
            };

            const params: MessageSendParams = {
                message: createTestMessage('Test task with slow push notifications'),
                configuration: {
                    pushNotificationConfig: slowConfig
                }
            };

            // Mock the agent executor to publish only completed state
            mockAgentExecutor.execute.callsFake(async (ctx, bus) => {
                const taskId = ctx.taskId;
                const contextId = ctx.contextId;
                
                // Publish task creation
                bus.publish({ 
                    id: taskId, 
                    contextId, 
                    status: { state: "submitted" }, 
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

            // Send message
            await handler.sendMessage(params);

            // Wait for slow push notifications
            await new Promise(resolve => setTimeout(resolve, 300));

            // Should receive notifications even from slow endpoint
            assert.isTrue(receivedNotifications.length >= 2, 'Should receive notifications from slow endpoint');
            
            // Verify all notifications were received
            const slowNotifications = receivedNotifications.filter(n => n.url === '/notify/slow');
            assert.isTrue(slowNotifications.length >= 2, 'Slow endpoint should receive all status updates');
        });
    });
});

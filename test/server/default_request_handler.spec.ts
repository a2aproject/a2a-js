import 'mocha';
import { assert, expect } from 'chai';
import sinon, { SinonStub, SinonFakeTimers } from 'sinon';

import { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';
import { RequestContext, ExecutionEventBus, TaskStore, InMemoryTaskStore, DefaultRequestHandler, ExecutionEventQueue, A2AError, InMemoryPushNotificationStore, PushNotificationStore, PushNotificationSender } from '../../src/server/index.js';
import { AgentCard, Artifact, DeleteTaskPushNotificationConfigParams, GetTaskPushNotificationConfigParams, ListTaskPushNotificationConfigParams, Message, MessageSendParams, PushNotificationConfig, Task, TaskIdParams, TaskPushNotificationConfig, TaskState, TaskStatusUpdateEvent } from '../../src/index.js';
import { DefaultExecutionEventBusManager, ExecutionEventBusManager } from '../../src/server/events/execution_event_bus_manager.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { MockAgentExecutor, CancellableMockAgentExecutor, fakeTaskExecute } from './mocks/agent-executor.mock.js';
import { MockPushNotificationSender } from './mocks/push_notification_sender.mock.js';


describe('DefaultRequestHandler as A2ARequestHandler', () => {
    let handler: A2ARequestHandler;
    let mockTaskStore: TaskStore;
    let mockAgentExecutor: AgentExecutor;
    let executionEventBusManager: ExecutionEventBusManager;
    let mockPushNotificationStore: PushNotificationStore;
    let mockPushNotificationSender: PushNotificationSender;
    let clock: SinonFakeTimers;

    const testAgentCard: AgentCard = {
        name: 'Test Agent',
        description: 'An agent for testing purposes',
        url: 'http://localhost:8080',
        version: '1.0.0',
        protocolVersion: '0.3.0',
        capabilities: {
            streaming: true,
            pushNotifications: true,
        },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [
            {
                id: 'test-skill',
                name: 'Test Skill',
                description: 'A skill for testing',
                tags: ['test'],
            },
        ],
    };

    // Before each test, reset the components to a clean state
    beforeEach(() => {
        mockTaskStore = new InMemoryTaskStore();
        // Default mock for most tests
        mockAgentExecutor = new MockAgentExecutor();
        executionEventBusManager = new DefaultExecutionEventBusManager();
        handler = new DefaultRequestHandler(
            testAgentCard,
            mockTaskStore,
            mockAgentExecutor,
            executionEventBusManager,
        );
    });
    
    // After each test, restore any sinon fakes or stubs
    afterEach(() => {
        sinon.restore();
        if(clock) {
            clock.restore();
        }
    });

    // Helper function to create a basic user message
    const createTestMessage = (id: string, text: string): Message => ({
        messageId: id,
        role: 'user',
        parts: [{ kind: 'text', text }],
        kind: 'message',
    });

    it('sendMessage: should return a simple message response', async () => {
        const params: MessageSendParams = {
            message: createTestMessage('msg-1', 'Hello'),
        };

        const agentResponse: Message = {
            messageId: 'agent-msg-1',
            role: 'agent',
            parts: [{ kind: 'text', text: 'Hi there!' }],
            kind: 'message',
        };

        (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
            bus.publish(agentResponse);
            bus.finished();
        });

        const result = await handler.sendMessage(params);

        assert.deepEqual(result, agentResponse, "The result should be the agent's message");
        assert.isTrue((mockAgentExecutor as MockAgentExecutor).execute.calledOnce, "AgentExecutor.execute should be called once");
    });

    it('sendMessage: (blocking) should return a task in a completed state with an artifact', async () => {
        const params: MessageSendParams = { 
            message: createTestMessage('msg-2', 'Do a task') 
        };

        const taskId = 'task-123';
        const contextId = 'ctx-abc';
        const testArtifact: Artifact = {
            artifactId: 'artifact-1',
            name: 'Test Document',
            description: 'A test artifact.',
            parts: [{ kind: 'text', text: 'This is the content of the artifact.' }]
        };

        (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
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
                status: { state: "working" },
                final: false
            });
            bus.publish({
                taskId,
                contextId,
                kind: 'artifact-update',
                artifact: testArtifact
            });
            bus.publish({
                taskId,
                contextId,
                kind: 'status-update',
                status: { state: "completed", message: { role: 'agent', parts: [{kind: 'text', text: 'Done!'}], messageId: 'agent-msg-2', kind: 'message'} },
                final: true
            });
            bus.finished();
        });

        const result = await handler.sendMessage(params);
        const taskResult = result as Task;

        assert.equal(taskResult.kind, 'task');
        assert.equal(taskResult.id, taskId);
        assert.equal(taskResult.status.state, "completed");
        assert.isDefined(taskResult.artifacts, 'Task result should have artifacts');
        assert.isArray(taskResult.artifacts);
        assert.lengthOf(taskResult.artifacts!, 1);
        assert.deepEqual(taskResult.artifacts![0], testArtifact);
    });

    it('sendMessage: should handle agent execution failure for blocking calls', async () => {
        const errorMessage = 'Agent failed!';
        (mockAgentExecutor as MockAgentExecutor).execute.rejects(new Error(errorMessage));
    
        // Test blocking case
        const blockingParams: MessageSendParams = {
            message: createTestMessage('msg-fail-block', 'Test failure blocking'),
        };
        
        const blockingResult = await handler.sendMessage(blockingParams);
        const blockingTask = blockingResult as Task;
        assert.equal(blockingTask.kind, 'task', 'Result should be a task');
        assert.equal(blockingTask.status.state, 'failed', 'Task status should be failed');
        assert.include((blockingTask.status.message?.parts[0] as any).text, errorMessage, 'Error message should be in the status');
    });

    it('sendMessage: (non-blocking) should return first task event immediately and process full task in background', async () => {
        clock = sinon.useFakeTimers();
        const saveSpy = sinon.spy(mockTaskStore, 'save');

        const params: MessageSendParams = { 
            message: createTestMessage('msg-nonblock', 'Do a long task'),
            configuration: { blocking: false, acceptedOutputModes: [] }
        };

        const taskId = 'task-nonblock-123';
        const contextId = 'ctx-nonblock-abc';

        (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
            // First event is the task creation, which should be returned immediately
            bus.publish({
                id: taskId,
                contextId,
                status: { state: "submitted" },
                kind: 'task'
            });

            // Simulate work before publishing more events
            await clock.tickAsync(500);

            bus.publish({
                taskId,
                contextId,
                kind: 'status-update',
                status: { state: "completed" },
                final: true
            });
            bus.finished();
        });

        // This call should return as soon as the first 'task' event is published
        const immediateResult = await handler.sendMessage(params);
        
        // Assert that we got the initial task object back right away
        const taskResult = immediateResult as Task;
        assert.equal(taskResult.kind, 'task');
        assert.equal(taskResult.id, taskId);
        assert.equal(taskResult.status.state, 'submitted', "Should return immediately with 'submitted' state");

        // The background processing should not have completed yet
        assert.isTrue(saveSpy.calledOnce, "Save should be called for the initial task creation");
        assert.equal(saveSpy.firstCall.args[0].status.state, 'submitted');

        // Allow the background processing to complete
        await clock.runAllAsync();
        
        // Now, check the final state in the store to ensure background processing finished
        const finalTask = await mockTaskStore.load(taskId);
        assert.isDefined(finalTask);
        assert.equal(finalTask!.status.state, 'completed', "Task should be 'completed' in the store after background processing");
        assert.isTrue(saveSpy.calledTwice, "Save should be called twice (submitted and completed)");
        assert.equal(saveSpy.secondCall.args[0].status.state, 'completed');
    });

    it('sendMessage: should handle agent execution failure for non-blocking calls', async () => {
        const errorMessage = 'Agent failed!';
        (mockAgentExecutor as MockAgentExecutor).execute.rejects(new Error(errorMessage));
    
        // Test non-blocking case
        const nonBlockingParams: MessageSendParams = {
            message: createTestMessage('msg-fail-nonblock', 'Test failure non-blocking'),
            configuration: { blocking: false, acceptedOutputModes: [] },
        };

        const nonBlockingResult = await handler.sendMessage(nonBlockingParams);
        const nonBlockingTask = nonBlockingResult as Task;
        assert.equal(nonBlockingTask.kind, 'task', 'Result should be a task');
        assert.equal(nonBlockingTask.status.state, 'failed', 'Task status should be failed');
        assert.include((nonBlockingTask.status.message?.parts[0] as any).text, errorMessage, 'Error message should be in the status');
    });

    it('sendMessageStream: should stream submitted, working, and completed events', async () => {
        const params: MessageSendParams = { 
            message: createTestMessage('msg-3', 'Stream a task') 
        };
        const taskId = 'task-stream-1';
        const contextId = 'ctx-stream-1';

        (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
            bus.publish({ id: taskId, contextId, status: { state: "submitted" }, kind: 'task' });
            await new Promise(res => setTimeout(res, 10));
            bus.publish({ taskId, contextId, kind: 'status-update', status: { state: "working" }, final: false });
            await new Promise(res => setTimeout(res, 10));
            bus.publish({ taskId, contextId, kind: 'status-update', status: { state: "completed" }, final: true });
            bus.finished();
        });
        
        const eventGenerator = handler.sendMessageStream(params);
        const events = [];
        for await (const event of eventGenerator) {
            events.push(event);
        }

        assert.lengthOf(events, 3, "Stream should yield 3 events");
        assert.equal((events[0] as Task).status.state, "submitted");
        assert.equal((events[1] as TaskStatusUpdateEvent).status.state, "working");
        assert.equal((events[2] as TaskStatusUpdateEvent).status.state, "completed");
        assert.isTrue((events[2] as TaskStatusUpdateEvent).final);
    });

    it('sendMessage: should reject if task is in a terminal state', async () => {
        const taskId = 'task-terminal-1';
        const terminalStates: TaskState[] = ['completed', 'failed', 'canceled', 'rejected'];

        for (const state of terminalStates) {
            const fakeTask: Task = {
                id: taskId,
                contextId: 'ctx-terminal',
                status: { state: state as TaskState },
                kind: 'task'
            };
            await mockTaskStore.save(fakeTask);

            const params: MessageSendParams = {
                message: { ...createTestMessage('msg-1', 'test'), taskId: taskId }
            };

            try {
                await handler.sendMessage(params);
                assert.fail(`Should have thrown for state: ${state}`);
            } catch (error: any) {
                expect(error.code).to.equal(-32600); // Invalid Request
                expect(error.message).to.contain(`Task ${taskId} is in a terminal state (${state}) and cannot be modified.`);
            }
        }
    });

    it('sendMessageStream: should reject if task is in a terminal state', async () => {
        const taskId = 'task-terminal-2';
        const fakeTask: Task = {
            id: taskId,
            contextId: 'ctx-terminal-stream',
            status: { state: 'completed' },
            kind: 'task'
        };
        await mockTaskStore.save(fakeTask);

        const params: MessageSendParams = {
            message: { ...createTestMessage('msg-1', 'test'), taskId: taskId }
        };

        const generator = handler.sendMessageStream(params);

        try {
            await generator.next();
            assert.fail('sendMessageStream should have thrown an error');
        } catch(error: any) {
            expect(error.code).to.equal(-32600);
            expect(error.message).to.contain(`Task ${taskId} is in a terminal state (completed) and cannot be modified.`);
        }
    });

    it('sendMessageStream: should stop at input-required state', async () => {
        const params: MessageSendParams = {
            message: createTestMessage('msg-4', 'I need input')
        };
        const taskId = 'task-input';
        const contextId = 'ctx-input';

        (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
            bus.publish({ id: taskId, contextId, status: { state: "submitted" }, kind: 'task' });
            bus.publish({ taskId, contextId, kind: 'status-update', status: { state: "input-required" }, final: true });
            bus.finished();
        });
        
        const eventGenerator = handler.sendMessageStream(params);
        const events = [];
        for await (const event of eventGenerator) {
            events.push(event);
        }

        assert.lengthOf(events, 2);
        const lastEvent = events[1] as TaskStatusUpdateEvent;
        assert.equal(lastEvent.status.state, "input-required");
        assert.isTrue(lastEvent.final);
    });

    it('resubscribe: should allow multiple clients to receive events for the same task', async () => {
        const saveSpy = sinon.spy(mockTaskStore, 'save');
        clock = sinon.useFakeTimers();
        const params: MessageSendParams = {
            message: createTestMessage('msg-5', 'Long running task')
        };

        let taskId;
        let contextId;
    
        (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
            taskId = ctx.taskId;
            contextId = ctx.contextId;

            bus.publish({ id: taskId, contextId, status: { state: "submitted" }, kind: 'task' });
            bus.publish({ taskId, contextId, kind: 'status-update', status: { state: "working" }, final: false });
            await clock.tickAsync(100);
            bus.publish({ taskId, contextId, kind: 'status-update', status: { state: "completed" }, final: true });
            bus.finished();
        });
    
        const stream1_generator = handler.sendMessageStream(params);
        const stream1_iterator = stream1_generator[Symbol.asyncIterator]();
    
        const firstEventResult = await stream1_iterator.next();
        const firstEvent = firstEventResult.value as Task;
        assert.equal(firstEvent.id, taskId, 'Should get task event first');

        const secondEventResult = await stream1_iterator.next();
        const secondEvent = secondEventResult.value as TaskStatusUpdateEvent;
        assert.equal(secondEvent.taskId, taskId, 'Should get the task status update event second');
    
        const stream2_generator = handler.resubscribe({ id: taskId });
    
        const results1: any[] = [firstEvent, secondEvent];
        const results2: any[] = [];
    
        const collect = async (iterator: AsyncGenerator<any>, results: any[]) => {
            for await (const res of iterator) {
                results.push(res);
            }
        };
    
        const p1 = collect(stream1_iterator, results1);
        const p2 = collect(stream2_generator, results2);
    
        await clock.runAllAsync();
        await Promise.all([p1, p2]);

        assert.equal((results1[0] as TaskStatusUpdateEvent).status.state, "submitted");
        assert.equal((results1[1] as TaskStatusUpdateEvent).status.state, "working");
        assert.equal((results1[2] as TaskStatusUpdateEvent).status.state, "completed");

        // First event of resubscribe is always a task.
        assert.equal((results2[0] as Task).status.state, "working");
        assert.equal((results2[1] as TaskStatusUpdateEvent).status.state, "completed");
        
        assert.isTrue(saveSpy.calledThrice, 'TaskStore.save should be called 3 times');
        const lastSaveCall = saveSpy.lastCall.args[0];
        assert.equal(lastSaveCall.id, taskId);
        assert.equal(lastSaveCall.status.state, "completed");
    });
    
    it('getTask: should return an existing task from the store', async () => {
        const fakeTask: Task = {
            id: 'task-exist',
            contextId: 'ctx-exist',
            status: { state: "working" },
            kind: 'task',
            history: []
        };
        await mockTaskStore.save(fakeTask);

        const result = await handler.getTask({ id: 'task-exist' });
        assert.deepEqual(result, fakeTask);
    });

    it('set/getTaskPushNotificationConfig: should save and retrieve config', async () => {
        const taskId = 'task-push-config';
        const fakeTask: Task = { id: taskId, contextId: 'ctx-push', status: { state: "working" }, kind: 'task' };
        await mockTaskStore.save(fakeTask);
    
        const pushConfig: PushNotificationConfig = {
            id: 'config-1',
            url: 'https://example.com/notify',
            token: 'secret-token'
        };
    
        const setParams: TaskPushNotificationConfig = { taskId, pushNotificationConfig: pushConfig };
        const setResponse = await handler.setTaskPushNotificationConfig(setParams);
        assert.deepEqual(setResponse.pushNotificationConfig, pushConfig, "Set response should return the config");
    
        const getParams: GetTaskPushNotificationConfigParams = { id: taskId, pushNotificationConfigId: 'config-1' };
        const getResponse = await handler.getTaskPushNotificationConfig(getParams);
        assert.deepEqual(getResponse.pushNotificationConfig, pushConfig, "Get response should return the saved config");
    });

    it('set/getTaskPushNotificationConfig: should save and retrieve config by task ID for backward compatibility', async () => {
        const taskId = 'task-push-compat';
        await mockTaskStore.save({ id: taskId, contextId: 'ctx-compat', status: { state: 'working' }, kind: 'task' });
        
        // Config ID defaults to task ID
        const pushConfig: PushNotificationConfig = { url: 'https://example.com/notify-compat' };
        await handler.setTaskPushNotificationConfig({ taskId, pushNotificationConfig: pushConfig });

        const getResponse = await handler.getTaskPushNotificationConfig({ id: taskId });
        expect(getResponse.pushNotificationConfig.id).to.equal(taskId);
        expect(getResponse.pushNotificationConfig.url).to.equal(pushConfig.url);
    });

    it('setTaskPushNotificationConfig: should overwrite an existing config with the same ID', async () => {
        const taskId = 'task-overwrite';
        await mockTaskStore.save({ id: taskId, contextId: 'ctx-overwrite', status: { state: 'working' }, kind: 'task' });
        const initialConfig: PushNotificationConfig = { id: 'config-same', url: 'https://initial.url' };
        await handler.setTaskPushNotificationConfig({ taskId, pushNotificationConfig: initialConfig });

        const newConfig: PushNotificationConfig = { id: 'config-same', url: 'https://new.url' };
        await handler.setTaskPushNotificationConfig({ taskId, pushNotificationConfig: newConfig });
        
        const configs = await handler.listTaskPushNotificationConfigs({ id: taskId });
        expect(configs).to.have.lengthOf(1);
        expect(configs[0].pushNotificationConfig.url).to.equal('https://new.url');
    });

    it('listTaskPushNotificationConfigs: should return all configs for a task', async () => {
        const taskId = 'task-list-configs';
        await mockTaskStore.save({ id: taskId, contextId: 'ctx-list', status: { state: 'working' }, kind: 'task' });
        const config1: PushNotificationConfig = { id: 'cfg1', url: 'https://url1.com' };
        const config2: PushNotificationConfig = { id: 'cfg2', url: 'https://url2.com' };
        await handler.setTaskPushNotificationConfig({ taskId, pushNotificationConfig: config1 });
        await handler.setTaskPushNotificationConfig({ taskId, pushNotificationConfig: config2 });

        const listParams: ListTaskPushNotificationConfigParams = { id: taskId };
        const listResponse = await handler.listTaskPushNotificationConfigs(listParams);
        
        expect(listResponse).to.be.an('array').with.lengthOf(2);
        assert.deepInclude(listResponse, { taskId, pushNotificationConfig: config1 });
        assert.deepInclude(listResponse, { taskId, pushNotificationConfig: config2 });
    });
    
    it('deleteTaskPushNotificationConfig: should remove a specific config', async () => {
        const taskId = 'task-delete-config';
        await mockTaskStore.save({ id: taskId, contextId: 'ctx-delete', status: { state: 'working' }, kind: 'task' });
        const config1: PushNotificationConfig = { id: 'cfg-del-1', url: 'https://url1.com' };
        const config2: PushNotificationConfig = { id: 'cfg-del-2', url: 'https://url2.com' };
        await handler.setTaskPushNotificationConfig({ taskId, pushNotificationConfig: config1 });
        await handler.setTaskPushNotificationConfig({ taskId, pushNotificationConfig: config2 });

        const deleteParams: DeleteTaskPushNotificationConfigParams = { id: taskId, pushNotificationConfigId: 'cfg-del-1' };
        await handler.deleteTaskPushNotificationConfig(deleteParams);

        const remainingConfigs = await handler.listTaskPushNotificationConfigs({ id: taskId });
        expect(remainingConfigs).to.have.lengthOf(1);
        expect(remainingConfigs[0].pushNotificationConfig.id).to.equal('cfg-del-2');
    });

    it('deleteTaskPushNotificationConfig: should remove the whole entry if last config is deleted', async () => {
        const taskId = 'task-delete-last-config';
        await mockTaskStore.save({ id: taskId, contextId: 'ctx-delete-last', status: { state: 'working' }, kind: 'task' });
        const config: PushNotificationConfig = { id: 'cfg-last', url: 'https://last.com' };
        await handler.setTaskPushNotificationConfig({ taskId, pushNotificationConfig: config });

        await handler.deleteTaskPushNotificationConfig({ id: taskId, pushNotificationConfigId: 'cfg-last' });

        const configs = await handler.listTaskPushNotificationConfigs({ id: taskId });
        expect(configs).to.be.an('array').with.lengthOf(0);
    });

    it('should send push notification when task update is received', async () => {
        const mockPushNotificationStore = new InMemoryPushNotificationStore();
        const mockPushNotificationSender = new MockPushNotificationSender();
        
        const handler = new DefaultRequestHandler(
            testAgentCard,
            mockTaskStore,
            mockAgentExecutor,
            executionEventBusManager,
            mockPushNotificationStore,
            mockPushNotificationSender,
        );
        const pushNotificationConfig: PushNotificationConfig = {
            url: 'https://push-1.com'
        };
        const contextId = 'ctx-push-1';

        const params: MessageSendParams = {
            message: {
                ...createTestMessage('msg-push-1', 'Work on task with push notification'),
                contextId: contextId,
            },
            configuration: {
                pushNotificationConfig: pushNotificationConfig
            }
        };

        let taskId: string;
        (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
            taskId = ctx.taskId;
            fakeTaskExecute(ctx, bus);
        });

        await handler.sendMessage(params);

        const expectedTask: Task = {
            id: taskId,
            contextId,
            status: { state: 'completed' },
            kind: 'task',
            history: [params.message as Message]
        };

        // Verify push notifications were sent with complete task objects
        assert.isTrue((mockPushNotificationSender as MockPushNotificationSender).send.calledThrice);
        
        // Verify first call (submitted state)
        const firstCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.firstCall.args[0] as Task;
        const expectedFirstTask: Task = {
            ...expectedTask,
            status: { state: 'submitted' }
        };
        assert.deepEqual(firstCallTask, expectedFirstTask);
        
        // // Verify second call (working state)
        const secondCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.secondCall.args[0] as Task;
        const expectedSecondTask: Task = {
            ...expectedTask,
            status: { state: 'working' }
        };
        assert.deepEqual(secondCallTask, expectedSecondTask);
        
        // // Verify third call (completed state)
        const thirdCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.thirdCall.args[0] as Task;
        const expectedThirdTask: Task = {
            ...expectedTask,
            status: { state: 'completed' }
        };
        assert.deepEqual(thirdCallTask, expectedThirdTask);
    });

    it('sendMessageStream: should send push notification when task update is received', async () => {
        const mockPushNotificationStore = new InMemoryPushNotificationStore();
        const mockPushNotificationSender = new MockPushNotificationSender();
        
        const handler = new DefaultRequestHandler(
            testAgentCard,
            mockTaskStore,
            mockAgentExecutor,
            executionEventBusManager,
            mockPushNotificationStore,
            mockPushNotificationSender,
        );
        const pushNotificationConfig: PushNotificationConfig = {
            url: 'https://push-stream-1.com'
        };

        const contextId = 'ctx-push-stream-1';

        const params: MessageSendParams = {
            message: {
                ...createTestMessage('msg-push-stream-1', 'Work on task with push notification via stream'),
                contextId: contextId,
            },
            configuration: {
                pushNotificationConfig: pushNotificationConfig
            }
        };

        let taskId: string;
        (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
            taskId = ctx.taskId;
            fakeTaskExecute(ctx, bus);
        });

        const eventGenerator = handler.sendMessageStream(params);
        const events = [];
        for await (const event of eventGenerator) {
            events.push(event);
        }

        // Verify stream events
        assert.lengthOf(events, 3, "Stream should yield 3 events");
        assert.equal((events[0] as Task).status.state, "submitted");
        assert.equal((events[1] as TaskStatusUpdateEvent).status.state, "working");
        assert.equal((events[2] as TaskStatusUpdateEvent).status.state, "completed");
        assert.isTrue((events[2] as TaskStatusUpdateEvent).final);

        // Verify push notifications were sent with complete task objects
        assert.isTrue((mockPushNotificationSender as MockPushNotificationSender).send.calledThrice);
        
        const expectedTask: Task = {
            id: taskId,
            contextId,
            status: { state: 'completed' },
            kind: 'task',
            history: [params.message as Message]
        };
        // Verify first call (submitted state)
        const firstCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.firstCall.args[0] as Task;
        const expectedFirstTask: Task = {
            ...expectedTask,
            status: { state: 'submitted' }
        };
        assert.deepEqual(firstCallTask, expectedFirstTask);
        
        // Verify second call (working state)
        const secondCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.secondCall.args[0] as Task;
        const expectedSecondTask: Task = {
            ...expectedTask,
            status: { state: 'working' }
        };
        assert.deepEqual(secondCallTask, expectedSecondTask);
        
        // Verify third call (completed state)
        const thirdCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.thirdCall.args[0] as Task;
        const expectedThirdTask: Task = {
            ...expectedTask,
            status: { state: 'completed' }
        };
        assert.deepEqual(thirdCallTask, expectedThirdTask);
    });

    it('Push Notification methods should throw error if task does not exist', async () => {
        const nonExistentTaskId = 'task-non-existent';
        const config: PushNotificationConfig = { id: 'cfg-x', url: 'https://x.com' };
        
        const methodsToTest = [
            { name: 'setTaskPushNotificationConfig', params: { taskId: nonExistentTaskId, pushNotificationConfig: config } },
            { name: 'getTaskPushNotificationConfig', params: { id: nonExistentTaskId, pushNotificationConfigId: 'cfg-x' } },
            { name: 'listTaskPushNotificationConfigs', params: { id: nonExistentTaskId } },
            { name: 'deleteTaskPushNotificationConfig', params: { id: nonExistentTaskId, pushNotificationConfigId: 'cfg-x' } },
        ];
    
        for (const method of methodsToTest) {
            try {
                await (handler as any)[method.name](method.params);
                assert.fail(`Method ${method.name} should have thrown for non-existent task.`);
            } catch (error: any) {
                expect(error).to.be.instanceOf(A2AError);
                expect(error.code).to.equal(-32001); // Task Not Found
            }
        }
    });

    it('Push Notification methods should throw error if pushNotifications are not supported', async () => {
        const unsupportedAgentCard = { ...testAgentCard, capabilities: { ...testAgentCard.capabilities, pushNotifications: false } };
        handler = new DefaultRequestHandler(unsupportedAgentCard, mockTaskStore, mockAgentExecutor, executionEventBusManager);
        
        const taskId = 'task-unsupported';
        await mockTaskStore.save({ id: taskId, contextId: 'ctx-unsupported', status: { state: 'working' }, kind: 'task' });
        const config: PushNotificationConfig = { id: 'cfg-u', url: 'https://u.com' };

        const methodsToTest = [
            { name: 'setTaskPushNotificationConfig', params: { taskId, pushNotificationConfig: config } },
            { name: 'getTaskPushNotificationConfig', params: { id: taskId, pushNotificationConfigId: 'cfg-u' } },
            { name: 'listTaskPushNotificationConfigs', params: { id: taskId } },
            { name: 'deleteTaskPushNotificationConfig', params: { id: taskId, pushNotificationConfigId: 'cfg-u' } },
        ];

        for (const method of methodsToTest) {
            try {
                await (handler as any)[method.name](method.params);
                assert.fail(`Method ${method.name} should have thrown for unsupported push notifications.`);
            } catch (error: any) {
                expect(error).to.be.instanceOf(A2AError);
                expect(error.code).to.equal(-32003); // Push Notification Not Supported
            }
        }
    });
    
    it('cancelTask: should cancel a running task and notify listeners', async () => {
        clock = sinon.useFakeTimers();
        // Use the more advanced mock for this specific test
        const cancellableExecutor = new CancellableMockAgentExecutor(clock);
        handler = new DefaultRequestHandler(
            testAgentCard,
            mockTaskStore,
            cancellableExecutor,
            executionEventBusManager,
        );

        const streamParams: MessageSendParams = { message: createTestMessage('msg-9', 'Start and cancel') };
        const streamGenerator = handler.sendMessageStream(streamParams);
        
        const streamEvents: any[] = [];
        const streamingPromise = (async () => {
            for await (const event of streamGenerator) {
                streamEvents.push(event);
            }
        })();

        // Allow the task to be created and enter the 'working' state
        await clock.tickAsync(150); 
        
        const createdTask = streamEvents.find(e => e.kind === 'task') as Task;
        assert.isDefined(createdTask, 'Task creation event should have been received');
        const taskId = createdTask.id;

        // Now, issue the cancel request
        const cancelResponse = await handler.cancelTask({ id: taskId });

        // Let the executor's loop run to completion to detect the cancellation
        await clock.runAllAsync();
        await streamingPromise;

        assert.isTrue(cancellableExecutor.cancelTaskSpy.calledOnceWith(taskId, sinon.match.any));
        
        const lastEvent = streamEvents[streamEvents.length - 1] as TaskStatusUpdateEvent;
        assert.equal(lastEvent.status.state, "canceled");
        
        const finalTask = await handler.getTask({ id: taskId });
        assert.equal(finalTask.status.state, "canceled");

        // Canceled API issues cancel request to executor and returns latest task state.
        // In this scenario, executor is waiting on clock to detect that task has been cancelled.
        // While the cancel API has returned with latest task state => Working.
        assert.equal(cancelResponse.status.state, "working");
    });

    it('cancelTask: should fail for tasks in a terminal state', async () => {
        const taskId = 'task-terminal';
        const fakeTask: Task = { id: taskId, contextId: 'ctx-terminal', status: { state: "completed" }, kind: 'task' };
        await mockTaskStore.save(fakeTask);

        try {
            await handler.cancelTask({ id: taskId });
            assert.fail('Should have thrown a TaskNotCancelableError');
        } catch (error: any) {
            assert.equal(error.code, -32002);
            expect(error.message).to.contain('Task not cancelable');
        }
        assert.isFalse((mockAgentExecutor as MockAgentExecutor).cancelTask.called);
    });

    it('should use contextId from incomingMessage if present (contextId assignment logic)', async () => {
        const params: MessageSendParams = {
            message: {
                messageId: 'msg-ctx',
                role: 'user',
                parts: [{ kind: 'text', text: 'Hello' }],
                kind: 'message',
                contextId: 'incoming-ctx-id',
            },
        };
        let capturedContextId: string | undefined;
        (mockAgentExecutor.execute as SinonStub).callsFake(async (ctx, bus) => {
            capturedContextId = ctx.contextId;
            bus.publish({
                id: ctx.taskId,
                contextId: ctx.contextId,
                status: { state: "submitted" },
                kind: 'task'
            });
            bus && bus.finished && bus.finished();
        });
        await handler.sendMessage(params);
        expect(capturedContextId).to.equal('incoming-ctx-id');
    });

    it('should use contextId from task if not present in incomingMessage (contextId assignment logic)', async () => {
        const taskId = 'task-ctx-id';
        const taskContextId = 'task-context-id';
        await mockTaskStore.save({
            id: taskId,
            contextId: taskContextId,
            status: { state: 'working' },
            kind: 'task',
        });
        const params: MessageSendParams = {
            message: {
                messageId: 'msg-ctx2',
                role: 'user',
                parts: [{ kind: 'text', text: 'Hi' }],
                kind: 'message',
                taskId,
            },
        };
        let capturedContextId: string | undefined;
        (mockAgentExecutor.execute as SinonStub).callsFake(async (ctx, bus) => {
            capturedContextId = ctx.contextId;
            bus.publish({
                id: ctx.taskId,
                contextId: ctx.contextId,
                status: { state: "submitted" },
                kind: 'task'
            });
            bus && bus.finished && bus.finished();
        });
        await handler.sendMessage(params);
        expect(capturedContextId).to.equal(taskContextId);
    });

    it('should generate a new contextId if not present in message or task (contextId assignment logic)', async () => {
        const params: MessageSendParams = {
            message: {
                messageId: 'msg-ctx3',
                role: 'user',
                parts: [{ kind: 'text', text: 'Hey' }],
                kind: 'message',
            },
        };
        let capturedContextId: string | undefined;
        (mockAgentExecutor.execute as SinonStub).callsFake(async (ctx, bus) => {
            capturedContextId = ctx.contextId;
            bus.publish({
                id: ctx.taskId,
                contextId: ctx.contextId,
                status: { state: "submitted" },
                kind: 'task'
            });
            bus && bus.finished && bus.finished();
        });
        await handler.sendMessage(params);
        expect(capturedContextId).to.be.a('string').and.not.empty;
    });
      
    it('ExecutionEventQueue should be instantiable and return an object', () => {
        const fakeBus = {
            on: () => {},
            off: () => {}
        } as any;
        const queue = new ExecutionEventQueue(fakeBus);
        expect(queue).to.be.instanceOf(ExecutionEventQueue);
    });
});

import { describe, it, beforeEach, afterEach, assert, expect } from 'vitest';
import sinon, { SinonStub, SinonFakeTimers } from 'sinon';

import { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';
import {
  TaskStore,
  InMemoryTaskStore,
  DefaultRequestHandler,
  ExecutionEventQueue,
  A2AError,
  InMemoryPushNotificationStore,
  RequestContext,
  ExecutionEventBus,
  UnauthenticatedUser,
  ExtendedAgentCardProvider,
  User,
} from '../../src/server/index.js';
import {
  AgentCard,
  Artifact,
  DeleteTaskPushNotificationConfigParams,
  GetTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigParams,
  Message,
  MessageSendParams,
  PushNotificationConfig,
  Task,
  TaskPushNotificationConfig,
  TaskState,
  TaskStatusUpdateEvent,
  TextPart,
} from '../../src/index.js';
import {
  DefaultExecutionEventBusManager,
  ExecutionEventBusManager,
} from '../../src/server/events/execution_event_bus_manager.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import {
  MockAgentExecutor,
  CancellableMockAgentExecutor,
  fakeTaskExecute,
  FailingCancellableMockAgentExecutor,
} from './mocks/agent-executor.mock.js';
import { MockPushNotificationSender } from './mocks/push_notification_sender.mock.js';
import { ServerCallContext } from '../../src/server/context.js';
import { MockTaskStore } from './mocks/task_store.mock.js';

describe('DefaultRequestHandler as A2ARequestHandler', () => {
  let handler: A2ARequestHandler;
  let mockTaskStore: TaskStore;
  let mockAgentExecutor: AgentExecutor;
  let executionEventBusManager: ExecutionEventBusManager;
  let clock: SinonFakeTimers;

  const testAgentCard: AgentCard = {
    name: 'Test Agent',
    description: 'An agent for testing purposes',
    url: 'http://localhost:8080',
    version: '1.0.0',
    protocolVersion: '0.3.0',
    capabilities: {
      extensions: [{ uri: 'requested-extension-uri' }],
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

  const serverCallContext = new ServerCallContext();

  // Before each test, reset the components to a clean state
  beforeEach(() => {
    // Wrap in-memory store into a store which ensures we pass server call context.
    // The parameter is optional to avoid breaking changes, however it should be passed.
    const inMemoryStore = new InMemoryTaskStore();
    mockTaskStore = {
      save: async (task: Task, ctx?: ServerCallContext) => {
        if (!ctx) {
          throw new Error('Missing server call context');
        }
        return inMemoryStore.save(task);
      },
      load: async (id: string, ctx?: ServerCallContext) => {
        if (!ctx) {
          throw new Error('Missing server call context');
        }
        return inMemoryStore.load(id);
      },
    };
    // Default mock for most tests
    mockAgentExecutor = new MockAgentExecutor();
    executionEventBusManager = new DefaultExecutionEventBusManager();
    handler = new DefaultRequestHandler(
      testAgentCard,
      mockTaskStore,
      mockAgentExecutor,
      executionEventBusManager
    );
  });

  // After each test, restore any sinon fakes or stubs
  afterEach(() => {
    sinon.restore();
    if (clock) {
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

    const result = await handler.sendMessage(params, serverCallContext);

    assert.deepEqual(result, agentResponse, "The result should be the agent's message");
    assert.isTrue(
      (mockAgentExecutor as MockAgentExecutor).execute.calledOnce,
      'AgentExecutor.execute should be called once'
    );
  });

  it('sendMessage: (blocking) should return a task in a completed state with an artifact', async () => {
    const params: MessageSendParams = {
      message: createTestMessage('msg-2', 'Do a task'),
    };

    const taskId = 'task-123';
    const contextId = 'ctx-abc';
    const testArtifact: Artifact = {
      artifactId: 'artifact-1',
      name: 'Test Document',
      description: 'A test artifact.',
      parts: [{ kind: 'text', text: 'This is the content of the artifact.' }],
    };

    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      bus.publish({
        id: taskId,
        contextId,
        status: { state: 'submitted' },
        kind: 'task',
      });
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'working' },
        final: false,
      });
      bus.publish({
        taskId,
        contextId,
        kind: 'artifact-update',
        artifact: testArtifact,
      });
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: {
          state: 'completed',
          message: {
            role: 'agent',
            parts: [{ kind: 'text', text: 'Done!' }],
            messageId: 'agent-msg-2',
            kind: 'message',
          },
        },
        final: true,
      });
      bus.finished();
    });

    const result = await handler.sendMessage(params, serverCallContext);
    const taskResult = result as Task;

    assert.equal(taskResult.kind, 'task');
    assert.equal(taskResult.id, taskId);
    assert.equal(taskResult.status.state, 'completed');
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

    const blockingResult = await handler.sendMessage(blockingParams, serverCallContext);
    const blockingTask = blockingResult as Task;
    assert.equal(blockingTask.kind, 'task', 'Result should be a task');
    assert.equal(blockingTask.status.state, 'failed', 'Task status should be failed');
    assert.include(
      (blockingTask.status.message?.parts[0] as any).text,
      errorMessage,
      'Error message should be in the status'
    );
  });

  it('sendMessage: (non-blocking) should return first task event immediately and process full task in background', async () => {
    clock = sinon.useFakeTimers();
    const saveSpy = sinon.spy(mockTaskStore, 'save');

    const params: MessageSendParams = {
      message: createTestMessage('msg-nonblock', 'Do a long task'),
      configuration: { blocking: false, acceptedOutputModes: [] },
    };

    const taskId = 'task-nonblock-123';
    const contextId = 'ctx-nonblock-abc';

    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      // First event is the task creation, which should be returned immediately
      bus.publish({
        id: taskId,
        contextId,
        status: { state: 'submitted' },
        kind: 'task',
      });

      // Simulate work before publishing more events
      await clock.tickAsync(500);

      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'completed' },
        final: true,
      });
      bus.finished();
    });

    // This call should return as soon as the first 'task' event is published
    const immediateResult = await handler.sendMessage(params, serverCallContext);

    // Assert that we got the initial task object back right away
    const taskResult = immediateResult as Task;
    assert.equal(taskResult.kind, 'task');
    assert.equal(taskResult.id, taskId);
    assert.equal(
      taskResult.status.state,
      'submitted',
      "Should return immediately with 'submitted' state"
    );

    // The background processing should not have completed yet
    assert.isTrue(saveSpy.calledOnce, 'Save should be called for the initial task creation');
    assert.equal(saveSpy.firstCall.args[0].status.state, 'submitted');

    // Allow the background processing to complete
    await clock.runAllAsync();

    // Now, check the final state in the store to ensure background processing finished
    const finalTask = await mockTaskStore.load(taskId, serverCallContext);
    assert.isDefined(finalTask);
    assert.equal(
      finalTask!.status.state,
      'completed',
      "Task should be 'completed' in the store after background processing"
    );
    assert.isTrue(saveSpy.calledTwice, 'Save should be called twice (submitted and completed)');
    assert.equal(saveSpy.secondCall.args[0].status.state, 'completed');
  });

  it('sendMessage: (non-blocking) should handle failure in event loop after successfull task event', async () => {
    clock = sinon.useFakeTimers();

    const mockTaskStore = new MockTaskStore();
    const handler = new DefaultRequestHandler(
      testAgentCard,
      mockTaskStore,
      mockAgentExecutor,
      executionEventBusManager
    );

    const params: MessageSendParams = {
      message: createTestMessage('msg-nonblock', 'Do a long task'),
      configuration: {
        blocking: false,
        acceptedOutputModes: [],
      },
    };

    const taskId = 'task-nonblock-123';
    const contextId = 'ctx-nonblock-abc';
    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      // First event is the task creation, which should be returned immediately
      bus.publish({
        id: taskId,
        contextId,
        status: { state: 'submitted' },
        kind: 'task',
      });

      // Simulate work before publishing more events
      await clock.tickAsync(500);

      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'completed' },
        final: true,
      });
      bus.finished();
    });

    let finalTaskSaved: Task | undefined;
    const errorMessage = 'Error thrown on saving completed task notification';
    (mockTaskStore as MockTaskStore).save.callsFake(async (task) => {
      if (task.status.state == 'completed') {
        throw new Error(errorMessage);
      }

      if (task.status.state == 'failed') {
        finalTaskSaved = task;
      }
    });

    // This call should return as soon as the first 'task' event is published
    const immediateResult = await handler.sendMessage(params, serverCallContext);

    // Assert that we got the initial task object back right away
    const taskResult = immediateResult as Task;
    assert.equal(taskResult.kind, 'task');
    assert.equal(taskResult.id, taskId);
    assert.equal(
      taskResult.status.state,
      'submitted',
      "Should return immediately with 'submitted' state"
    );

    // Allow the background processing to complete
    await clock.runAllAsync();

    assert.equal(finalTaskSaved!.status.state, 'failed');
    assert.equal(finalTaskSaved!.id, taskId);
    assert.equal(finalTaskSaved!.contextId, contextId);
    assert.equal(finalTaskSaved!.status.message!.role, 'agent');
    assert.equal(
      (finalTaskSaved!.status.message!.parts[0] as TextPart).text,
      `Event processing loop failed: ${errorMessage}`
    );
  });

  it('sendMessage: should handle agent execution failure for non-blocking calls', async () => {
    const errorMessage = 'Agent failed!';
    (mockAgentExecutor as MockAgentExecutor).execute.rejects(new Error(errorMessage));

    // Test non-blocking case
    const nonBlockingParams: MessageSendParams = {
      message: createTestMessage('msg-fail-nonblock', 'Test failure non-blocking'),
      configuration: { blocking: false, acceptedOutputModes: [] },
    };

    const nonBlockingResult = await handler.sendMessage(nonBlockingParams, serverCallContext);
    const nonBlockingTask = nonBlockingResult as Task;
    assert.equal(nonBlockingTask.kind, 'task', 'Result should be a task');
    assert.equal(nonBlockingTask.status.state, 'failed', 'Task status should be failed');
    assert.include(
      (nonBlockingTask.status.message?.parts[0] as any).text,
      errorMessage,
      'Error message should be in the status'
    );
  });

  it('sendMessage: should return second task with full history if message is sent to an existing, non-terminal task', async () => {
    const contextId = 'ctx-history-abc';

    // First message
    const firstMessage = createTestMessage('msg-1', 'Message 1');
    firstMessage.contextId = contextId;
    const firstParams: MessageSendParams = {
      message: firstMessage,
    };

    let taskId: string;

    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      taskId = ctx.taskId;

      // Publish task creation
      bus.publish({
        id: taskId,
        contextId,
        status: { state: 'submitted' },
        kind: 'task',
      });

      // Publish working status
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'working' },
        final: false,
      });

      // Mark as input-required with agent response message
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: {
          state: 'input-required',
          message: {
            messageId: 'agent-msg-1',
            role: 'agent',
            parts: [{ kind: 'text', text: 'Response to message 1' }],
            kind: 'message',
            taskId,
            contextId,
          },
        },
        final: true,
      });
      bus.finished();
    });

    const firstResult = await handler.sendMessage(firstParams, serverCallContext);
    const firstTask = firstResult as Task;

    // Check the first result is a task with `input-required` status
    assert.equal(firstTask.kind, 'task');
    assert.equal(firstTask.status.state, 'input-required');

    // Check the history
    assert.isDefined(firstTask.history, 'First task should have history');
    assert.lengthOf(
      firstTask.history!,
      2,
      'First task history should contain user message and agent message'
    );
    assert.equal(
      firstTask.history![0].messageId,
      'msg-1',
      'First history item should be user message'
    );
    assert.equal(
      firstTask.history![1].messageId,
      'agent-msg-1',
      'Second history item should be agent message'
    );

    // Second message
    const secondMessage = createTestMessage('msg-2', 'Message 2');
    secondMessage.contextId = contextId;
    secondMessage.taskId = firstTask.id;

    const secondParams: MessageSendParams = {
      message: secondMessage,
    };

    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      // Publish a status update with working state
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'working' },
        final: false,
      });

      // Publish a status update with working state and message
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: {
          state: 'working',
          message: {
            messageId: 'agent-msg-2',
            role: 'agent',
            parts: [{ kind: 'text', text: 'Response to message 2' }],
            kind: 'message',
            taskId,
            contextId,
          },
        },
        final: false,
      });

      // Publish an artifact update
      bus.publish({
        taskId,
        contextId,
        kind: 'artifact-update',
        artifact: {
          artifactId: 'artifact-1',
          name: 'Test Document',
          description: 'A test artifact.',
          parts: [{ kind: 'text', text: 'This is the content of the artifact.' }],
        },
      });

      // Mark as completed
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: {
          state: 'completed',
        },
        final: true,
      });

      bus.finished();
    });

    const secondResult = await handler.sendMessage(secondParams, serverCallContext);
    const secondTask = secondResult as Task;

    // Check the second result is a task with `completed` status
    assert.equal(secondTask.kind, 'task');
    assert.equal(secondTask.id, taskId, 'Should be the same task');
    assert.equal(secondTask.status.state, 'completed');

    // Check the history
    assert.isDefined(secondTask.history, 'Second task should have history');
    assert.lengthOf(
      secondTask.history!,
      4,
      'Second task history should contain all 4 messages (user1, agent1, user2, agent2)'
    );
    assert.equal(
      secondTask.history![0].messageId,
      'msg-1',
      'First message should be first user message'
    );
    assert.equal((secondTask.history![0].parts[0] as any).text, 'Message 1');
    assert.equal(
      secondTask.history![1].messageId,
      'agent-msg-1',
      'Second message should be first agent message'
    );
    assert.equal((secondTask.history![1].parts[0] as any).text, 'Response to message 1');
    assert.equal(
      secondTask.history![2].messageId,
      'msg-2',
      'Third message should be second user message'
    );
    assert.equal((secondTask.history![2].parts[0] as any).text, 'Message 2');
    assert.equal(
      secondTask.history![3].messageId,
      'agent-msg-2',
      'Fourth message should be second agent message'
    );
    assert.equal((secondTask.history![3].parts[0] as any).text, 'Response to message 2');
    assert.equal(secondTask.artifacts![0].artifactId, 'artifact-1', 'Artifact should be the same');
    assert.equal(
      secondTask.artifacts![0].name,
      'Test Document',
      'Artifact name should be the same'
    );
    assert.equal(
      secondTask.artifacts![0].description,
      'A test artifact.',
      'Artifact description should be the same'
    );
    assert.equal(
      (secondTask.artifacts![0].parts[0] as any).text,
      'This is the content of the artifact.',
      'Artifact content should be the same'
    );
  });

  it('sendMessage: should return second task with full history if message is sent to an existing, non-terminal task, in non-blocking mode', async () => {
    const contextId = 'ctx-history-abc';
    clock = sinon.useFakeTimers();

    // First message
    const firstMessage = createTestMessage('msg-1', 'Message 1');
    firstMessage.contextId = contextId;
    const firstParams: MessageSendParams = {
      message: firstMessage,
    };

    let taskId: string;

    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      taskId = ctx.taskId;

      // Publish task creation
      bus.publish({
        id: taskId,
        contextId,
        status: { state: 'submitted' },
        kind: 'task',
      });

      // Publish working status
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'working' },
        final: false,
      });

      // Mark as input-required with agent response message
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: {
          state: 'input-required',
          message: {
            messageId: 'agent-msg-1',
            role: 'agent',
            parts: [{ kind: 'text', text: 'Response to message 1' }],
            kind: 'message',
            taskId,
            contextId,
          },
        },
        final: true,
      });
      bus.finished();
    });

    const firstResult = await handler.sendMessage(firstParams, serverCallContext);
    const firstTask = firstResult as Task;

    // Check the first result is a task with `input-required` status
    assert.equal(firstTask.kind, 'task');
    assert.equal(firstTask.status.state, 'input-required');

    // Check the history
    assert.isDefined(firstTask.history, 'First task should have history');
    assert.lengthOf(
      firstTask.history!,
      2,
      'First task history should contain user message and agent message'
    );
    assert.equal(
      firstTask.history![0].messageId,
      'msg-1',
      'First history item should be user message'
    );
    assert.equal(
      firstTask.history![1].messageId,
      'agent-msg-1',
      'Second history item should be agent message'
    );

    // Second message
    const secondMessage = createTestMessage('msg-2', 'Message 2');
    secondMessage.contextId = contextId;
    secondMessage.taskId = firstTask.id;

    const secondParams: MessageSendParams = {
      message: secondMessage,
      configuration: { blocking: false },
    };

    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      // Publish a status update with working state
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'working' },
        final: false,
      });

      await clock.tickAsync(10);

      // Publish a status update with working state and message
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: {
          state: 'working',
          message: {
            messageId: 'agent-msg-2',
            role: 'agent',
            parts: [{ kind: 'text', text: 'Response to message 2' }],
            kind: 'message',
            taskId,
            contextId,
          },
        },
        final: false,
      });

      // Publish an artifact update
      bus.publish({
        taskId,
        contextId,
        kind: 'artifact-update',
        artifact: {
          artifactId: 'artifact-1',
          name: 'Test Document',
          description: 'A test artifact.',
          parts: [{ kind: 'text', text: 'This is the content of the artifact.' }],
        },
      });

      // Mark as completed
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: {
          state: 'completed',
        },
        final: true,
      });

      bus.finished();
    });

    const secondResult = await handler.sendMessage(secondParams, serverCallContext);

    // Check the second result is a task with `completed` status
    const secondTask = secondResult as Task;
    assert.equal(secondTask.kind, 'task');
    assert.equal(secondTask.id, taskId, 'Should be the same task');
    assert.equal(secondTask.status.state, 'working'); // It will receive the Task in the status of the first published event

    await clock.runAllAsync(); // give time to the second task to publish all the updates

    const finalTask = await mockTaskStore.load(taskId, serverCallContext);

    // Check the history
    assert.equal(finalTask.status.state, 'completed');
    assert.isDefined(finalTask.history, 'Second task should have history');
    assert.lengthOf(
      finalTask.history!,
      4,
      'Second task history should contain all 4 messages (user1, agent1, user2, agent2)'
    );
    assert.equal(
      finalTask.history![0].messageId,
      'msg-1',
      'First message should be first user message'
    );
    assert.equal((finalTask.history![0].parts[0] as any).text, 'Message 1');
    assert.equal(
      finalTask.history![1].messageId,
      'agent-msg-1',
      'Second message should be first agent message'
    );
    assert.equal((finalTask.history![1].parts[0] as any).text, 'Response to message 1');
    assert.equal(
      finalTask.history![2].messageId,
      'msg-2',
      'Third message should be second user message'
    );
    assert.equal((finalTask.history![2].parts[0] as any).text, 'Message 2');
    assert.equal(
      finalTask.history![3].messageId,
      'agent-msg-2',
      'Fourth message should be second agent message'
    );
    assert.equal((finalTask.history![3].parts[0] as any).text, 'Response to message 2');
    assert.equal(finalTask.artifacts![0].artifactId, 'artifact-1', 'Artifact should be the same');
    assert.equal(finalTask.artifacts![0].name, 'Test Document', 'Artifact name should be the same');
    assert.equal(
      finalTask.artifacts![0].description,
      'A test artifact.',
      'Artifact description should be the same'
    );
    assert.equal(
      (finalTask.artifacts![0].parts[0] as any).text,
      'This is the content of the artifact.',
      'Artifact content should be the same'
    );
  });

  it('sendMessageStream: should stream submitted, working, and completed events', async () => {
    const params: MessageSendParams = {
      message: createTestMessage('msg-3', 'Stream a task'),
    };
    const taskId = 'task-stream-1';
    const contextId = 'ctx-stream-1';

    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      bus.publish({
        id: taskId,
        contextId,
        status: { state: 'submitted' },
        kind: 'task',
      });
      await new Promise((res) => setTimeout(res, 10));
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'working' },
        final: false,
      });
      await new Promise((res) => setTimeout(res, 10));
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'completed' },
        final: true,
      });
      bus.finished();
    });

    const eventGenerator = handler.sendMessageStream(params, serverCallContext);
    const events = [];
    for await (const event of eventGenerator) {
      events.push(event);
    }

    assert.lengthOf(events, 3, 'Stream should yield 3 events');
    assert.equal((events[0] as Task).status.state, 'submitted');
    assert.equal((events[1] as TaskStatusUpdateEvent).status.state, 'working');
    assert.equal((events[2] as TaskStatusUpdateEvent).status.state, 'completed');
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
        kind: 'task',
      };
      await mockTaskStore.save(fakeTask, serverCallContext);

      const params: MessageSendParams = {
        message: { ...createTestMessage('msg-1', 'test'), taskId: taskId },
      };

      try {
        await handler.sendMessage(params, serverCallContext);
        assert.fail(`Should have thrown for state: ${state}`);
      } catch (error: any) {
        expect(error.code).to.equal(-32600); // Invalid Request
        expect(error.message).to.contain(
          `Task ${taskId} is in a terminal state (${state}) and cannot be modified.`
        );
      }
    }
  });

  it('sendMessageStream: should reject if task is in a terminal state', async () => {
    const taskId = 'task-terminal-2';
    const fakeTask: Task = {
      id: taskId,
      contextId: 'ctx-terminal-stream',
      status: { state: 'completed' },
      kind: 'task',
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    const params: MessageSendParams = {
      message: { ...createTestMessage('msg-1', 'test'), taskId: taskId },
    };

    const generator = handler.sendMessageStream(params, serverCallContext);

    try {
      await generator.next();
      assert.fail('sendMessageStream should have thrown an error');
    } catch (error: any) {
      expect(error.code).to.equal(-32600);
      expect(error.message).to.contain(
        `Task ${taskId} is in a terminal state (completed) and cannot be modified.`
      );
    }
  });

  it('sendMessageStream: should stop at input-required state', async () => {
    const params: MessageSendParams = {
      message: createTestMessage('msg-4', 'I need input'),
    };
    const taskId = 'task-input';
    const contextId = 'ctx-input';

    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      bus.publish({
        id: taskId,
        contextId,
        status: { state: 'submitted' },
        kind: 'task',
      });
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'input-required' },
        final: true,
      });
      bus.finished();
    });

    const eventGenerator = handler.sendMessageStream(params, serverCallContext);
    const events = [];
    for await (const event of eventGenerator) {
      events.push(event);
    }

    assert.lengthOf(events, 2);
    const lastEvent = events[1] as TaskStatusUpdateEvent;
    assert.equal(lastEvent.status.state, 'input-required');
    assert.isTrue(lastEvent.final);
  });

  it('resubscribe: should allow multiple clients to receive events for the same task', async () => {
    const saveSpy = sinon.spy(mockTaskStore, 'save');
    clock = sinon.useFakeTimers();
    const params: MessageSendParams = {
      message: createTestMessage('msg-5', 'Long running task'),
    };

    let taskId;
    let contextId;

    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      taskId = ctx.taskId;
      contextId = ctx.contextId;

      bus.publish({
        id: taskId,
        contextId,
        status: { state: 'submitted' },
        kind: 'task',
      });
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'working' },
        final: false,
      });
      await clock.tickAsync(100);
      bus.publish({
        taskId,
        contextId,
        kind: 'status-update',
        status: { state: 'completed' },
        final: true,
      });
      bus.finished();
    });

    const stream1_generator = handler.sendMessageStream(params, serverCallContext);
    const stream1_iterator = stream1_generator[Symbol.asyncIterator]();

    const firstEventResult = await stream1_iterator.next();
    const firstEvent = firstEventResult.value as Task;
    assert.equal(firstEvent.id, taskId, 'Should get task event first');

    const secondEventResult = await stream1_iterator.next();
    const secondEvent = secondEventResult.value as TaskStatusUpdateEvent;
    assert.equal(secondEvent.taskId, taskId, 'Should get the task status update event second');

    const stream2_generator = handler.resubscribe({ id: taskId }, serverCallContext);

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

    assert.equal((results1[0] as TaskStatusUpdateEvent).status.state, 'submitted');
    assert.equal((results1[1] as TaskStatusUpdateEvent).status.state, 'working');
    assert.equal((results1[2] as TaskStatusUpdateEvent).status.state, 'completed');

    // First event of resubscribe is always a task.
    assert.equal((results2[0] as Task).status.state, 'working');
    assert.equal((results2[1] as TaskStatusUpdateEvent).status.state, 'completed');

    assert.isTrue(saveSpy.calledThrice, 'TaskStore.save should be called 3 times');
    const lastSaveCall = saveSpy.lastCall.args[0];
    assert.equal(lastSaveCall.id, taskId);
    assert.equal(lastSaveCall.status.state, 'completed');
  });

  it('getTask: should return an existing task from the store', async () => {
    const fakeTask: Task = {
      id: 'task-exist',
      contextId: 'ctx-exist',
      status: { state: 'working' },
      kind: 'task',
      history: [],
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    const result = await handler.getTask({ id: 'task-exist' }, serverCallContext);
    assert.deepEqual(result, fakeTask);
  });

  it('set/getTaskPushNotificationConfig: should save and retrieve config', async () => {
    const taskId = 'task-push-config';
    const fakeTask: Task = {
      id: taskId,
      contextId: 'ctx-push',
      status: { state: 'working' },
      kind: 'task',
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    const pushConfig: PushNotificationConfig = {
      id: 'config-1',
      url: 'https://example.com/notify',
      token: 'secret-token',
    };

    const setParams: TaskPushNotificationConfig = {
      taskId,
      pushNotificationConfig: pushConfig,
    };
    const setResponse = await handler.setTaskPushNotificationConfig(setParams, serverCallContext);
    assert.deepEqual(
      setResponse.pushNotificationConfig,
      pushConfig,
      'Set response should return the config'
    );

    const getParams: GetTaskPushNotificationConfigParams = {
      id: taskId,
      pushNotificationConfigId: 'config-1',
    };
    const getResponse = await handler.getTaskPushNotificationConfig(getParams, serverCallContext);
    assert.deepEqual(
      getResponse.pushNotificationConfig,
      pushConfig,
      'Get response should return the saved config'
    );
  });

  it('set/getTaskPushNotificationConfig: should save and retrieve config by task ID for backward compatibility', async () => {
    const taskId = 'task-push-compat';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-compat',
        status: { state: 'working' },
        kind: 'task',
      },
      serverCallContext
    );

    // Config ID defaults to task ID
    const pushConfig: PushNotificationConfig = {
      url: 'https://example.com/notify-compat',
    };
    await handler.setTaskPushNotificationConfig(
      {
        taskId,
        pushNotificationConfig: pushConfig,
      },
      serverCallContext
    );

    const getResponse = await handler.getTaskPushNotificationConfig(
      {
        id: taskId,
      },
      serverCallContext
    );
    expect(getResponse.pushNotificationConfig.id).to.equal(taskId);
    expect(getResponse.pushNotificationConfig.url).to.equal(pushConfig.url);
  });

  it('setTaskPushNotificationConfig: should overwrite an existing config with the same ID', async () => {
    const taskId = 'task-overwrite';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-overwrite',
        status: { state: 'working' },
        kind: 'task',
      },
      serverCallContext
    );
    const initialConfig: PushNotificationConfig = {
      id: 'config-same',
      url: 'https://initial.url',
    };
    await handler.setTaskPushNotificationConfig(
      {
        taskId,
        pushNotificationConfig: initialConfig,
      },
      serverCallContext
    );

    const newConfig: PushNotificationConfig = {
      id: 'config-same',
      url: 'https://new.url',
    };
    await handler.setTaskPushNotificationConfig(
      {
        taskId,
        pushNotificationConfig: newConfig,
      },
      serverCallContext
    );

    const configs = await handler.listTaskPushNotificationConfigs(
      {
        id: taskId,
      },
      serverCallContext
    );
    expect(configs).to.have.lengthOf(1);
    expect(configs[0].pushNotificationConfig.url).to.equal('https://new.url');
  });

  it('listTaskPushNotificationConfigs: should return all configs for a task', async () => {
    const taskId = 'task-list-configs';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-list',
        status: { state: 'working' },
        kind: 'task',
      },
      serverCallContext
    );
    const config1: PushNotificationConfig = {
      id: 'cfg1',
      url: 'https://url1.com',
    };
    const config2: PushNotificationConfig = {
      id: 'cfg2',
      url: 'https://url2.com',
    };
    await handler.setTaskPushNotificationConfig(
      {
        taskId,
        pushNotificationConfig: config1,
      },
      serverCallContext
    );
    await handler.setTaskPushNotificationConfig(
      {
        taskId,
        pushNotificationConfig: config2,
      },
      serverCallContext
    );

    const listParams: ListTaskPushNotificationConfigParams = { id: taskId };
    const listResponse = await handler.listTaskPushNotificationConfigs(
      listParams,
      serverCallContext
    );

    expect(listResponse).to.be.an('array').with.lengthOf(2);
    assert.deepInclude(listResponse, {
      taskId,
      pushNotificationConfig: config1,
    });
    assert.deepInclude(listResponse, {
      taskId,
      pushNotificationConfig: config2,
    });
  });

  it('deleteTaskPushNotificationConfig: should remove a specific config', async () => {
    const taskId = 'task-delete-config';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-delete',
        status: { state: 'working' },
        kind: 'task',
      },
      serverCallContext
    );
    const config1: PushNotificationConfig = {
      id: 'cfg-del-1',
      url: 'https://url1.com',
    };
    const config2: PushNotificationConfig = {
      id: 'cfg-del-2',
      url: 'https://url2.com',
    };
    await handler.setTaskPushNotificationConfig(
      {
        taskId,
        pushNotificationConfig: config1,
      },
      serverCallContext
    );
    await handler.setTaskPushNotificationConfig(
      {
        taskId,
        pushNotificationConfig: config2,
      },
      serverCallContext
    );

    const deleteParams: DeleteTaskPushNotificationConfigParams = {
      id: taskId,
      pushNotificationConfigId: 'cfg-del-1',
    };
    await handler.deleteTaskPushNotificationConfig(deleteParams, serverCallContext);

    const remainingConfigs = await handler.listTaskPushNotificationConfigs(
      {
        id: taskId,
      },
      serverCallContext
    );
    expect(remainingConfigs).to.have.lengthOf(1);
    expect(remainingConfigs[0].pushNotificationConfig.id).to.equal('cfg-del-2');
  });

  it('deleteTaskPushNotificationConfig: should remove the whole entry if last config is deleted', async () => {
    const taskId = 'task-delete-last-config';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-delete-last',
        status: { state: 'working' },
        kind: 'task',
      },
      serverCallContext
    );
    const config: PushNotificationConfig = {
      id: 'cfg-last',
      url: 'https://last.com',
    };
    await handler.setTaskPushNotificationConfig(
      {
        taskId,
        pushNotificationConfig: config,
      },
      serverCallContext
    );

    await handler.deleteTaskPushNotificationConfig(
      {
        id: taskId,
        pushNotificationConfigId: 'cfg-last',
      },
      serverCallContext
    );

    const configs = await handler.listTaskPushNotificationConfigs(
      {
        id: taskId,
      },
      serverCallContext
    );
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
      mockPushNotificationSender
    );
    const pushNotificationConfig: PushNotificationConfig = {
      url: 'https://push-1.com',
    };
    const contextId = 'ctx-push-1';

    const params: MessageSendParams = {
      message: {
        ...createTestMessage('msg-push-1', 'Work on task with push notification'),
        contextId: contextId,
      },
      configuration: {
        pushNotificationConfig: pushNotificationConfig,
      },
    };

    let taskId: string;
    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      taskId = ctx.taskId;
      fakeTaskExecute(ctx, bus);
    });

    await handler.sendMessage(params, serverCallContext);

    const expectedTask: Task = {
      id: taskId,
      contextId,
      status: { state: 'completed' },
      kind: 'task',
      history: [params.message as Message],
    };

    // Verify push notifications were sent with complete task objects
    assert.isTrue((mockPushNotificationSender as MockPushNotificationSender).send.calledThrice);

    // Verify first call (submitted state)
    const firstCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.firstCall
      .args[0] as Task;
    const expectedFirstTask: Task = {
      ...expectedTask,
      status: { state: 'submitted' },
    };
    assert.deepEqual(firstCallTask, expectedFirstTask);

    // // Verify second call (working state)
    const secondCallTask = (mockPushNotificationSender as MockPushNotificationSender).send
      .secondCall.args[0] as Task;
    const expectedSecondTask: Task = {
      ...expectedTask,
      status: { state: 'working' },
    };
    assert.deepEqual(secondCallTask, expectedSecondTask);

    // // Verify third call (completed state)
    const thirdCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.thirdCall
      .args[0] as Task;
    const expectedThirdTask: Task = {
      ...expectedTask,
      status: { state: 'completed' },
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
      mockPushNotificationSender
    );
    const pushNotificationConfig: PushNotificationConfig = {
      url: 'https://push-stream-1.com',
    };

    const contextId = 'ctx-push-stream-1';

    const params: MessageSendParams = {
      message: {
        ...createTestMessage('msg-push-stream-1', 'Work on task with push notification via stream'),
        contextId: contextId,
      },
      configuration: {
        pushNotificationConfig: pushNotificationConfig,
      },
    };

    let taskId: string;
    (mockAgentExecutor as MockAgentExecutor).execute.callsFake(async (ctx, bus) => {
      taskId = ctx.taskId;
      fakeTaskExecute(ctx, bus);
    });

    const eventGenerator = handler.sendMessageStream(params, serverCallContext);
    const events = [];
    for await (const event of eventGenerator) {
      events.push(event);
    }

    // Verify stream events
    assert.lengthOf(events, 3, 'Stream should yield 3 events');
    assert.equal((events[0] as Task).status.state, 'submitted');
    assert.equal((events[1] as TaskStatusUpdateEvent).status.state, 'working');
    assert.equal((events[2] as TaskStatusUpdateEvent).status.state, 'completed');
    assert.isTrue((events[2] as TaskStatusUpdateEvent).final);

    // Verify push notifications were sent with complete task objects
    assert.isTrue((mockPushNotificationSender as MockPushNotificationSender).send.calledThrice);

    const expectedTask: Task = {
      id: taskId,
      contextId,
      status: { state: 'completed' },
      kind: 'task',
      history: [params.message as Message],
    };
    // Verify first call (submitted state)
    const firstCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.firstCall
      .args[0] as Task;
    const expectedFirstTask: Task = {
      ...expectedTask,
      status: { state: 'submitted' },
    };
    assert.deepEqual(firstCallTask, expectedFirstTask);

    // Verify second call (working state)
    const secondCallTask = (mockPushNotificationSender as MockPushNotificationSender).send
      .secondCall.args[0] as Task;
    const expectedSecondTask: Task = {
      ...expectedTask,
      status: { state: 'working' },
    };
    assert.deepEqual(secondCallTask, expectedSecondTask);

    // Verify third call (completed state)
    const thirdCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.thirdCall
      .args[0] as Task;
    const expectedThirdTask: Task = {
      ...expectedTask,
      status: { state: 'completed' },
    };
    assert.deepEqual(thirdCallTask, expectedThirdTask);
  });

  it('Push Notification methods should throw error if task does not exist', async () => {
    const nonExistentTaskId = 'task-non-existent';
    const config: PushNotificationConfig = {
      id: 'cfg-x',
      url: 'https://x.com',
    };

    const methodsToTest = [
      {
        name: 'setTaskPushNotificationConfig',
        params: { taskId: nonExistentTaskId, pushNotificationConfig: config },
      },
      {
        name: 'getTaskPushNotificationConfig',
        params: { id: nonExistentTaskId, pushNotificationConfigId: 'cfg-x' },
      },
      {
        name: 'listTaskPushNotificationConfigs',
        params: { id: nonExistentTaskId },
      },
      {
        name: 'deleteTaskPushNotificationConfig',
        params: { id: nonExistentTaskId, pushNotificationConfigId: 'cfg-x' },
      },
    ];

    for (const method of methodsToTest) {
      try {
        await (handler as any)[method.name](method.params, serverCallContext);
        assert.fail(`Method ${method.name} should have thrown for non-existent task.`);
      } catch (error: any) {
        expect(error).to.be.instanceOf(A2AError);
        expect(error.code).to.equal(-32001); // Task Not Found
      }
    }
  });

  it('Push Notification methods should throw error if pushNotifications are not supported', async () => {
    const unsupportedAgentCard = {
      ...testAgentCard,
      capabilities: { ...testAgentCard.capabilities, pushNotifications: false },
    };
    handler = new DefaultRequestHandler(
      unsupportedAgentCard,
      mockTaskStore,
      mockAgentExecutor,
      executionEventBusManager
    );

    const taskId = 'task-unsupported';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-unsupported',
        status: { state: 'working' },
        kind: 'task',
      },
      serverCallContext
    );
    const config: PushNotificationConfig = {
      id: 'cfg-u',
      url: 'https://u.com',
    };

    const methodsToTest = [
      {
        name: 'setTaskPushNotificationConfig',
        params: { taskId, pushNotificationConfig: config },
      },
      {
        name: 'getTaskPushNotificationConfig',
        params: { id: taskId, pushNotificationConfigId: 'cfg-u' },
      },
      { name: 'listTaskPushNotificationConfigs', params: { id: taskId } },
      {
        name: 'deleteTaskPushNotificationConfig',
        params: { id: taskId, pushNotificationConfigId: 'cfg-u' },
      },
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
      executionEventBusManager
    );

    const streamParams: MessageSendParams = {
      message: createTestMessage('msg-9', 'Start and cancel'),
    };
    const streamGenerator = handler.sendMessageStream(streamParams, serverCallContext);

    const streamEvents: any[] = [];
    (async () => {
      for await (const event of streamGenerator) {
        streamEvents.push(event);
      }
    })();

    // Allow the task to be created and enter the 'working' state
    await clock.tickAsync(150);

    const createdTask = streamEvents.find((e) => e.kind === 'task') as Task;
    assert.isDefined(createdTask, 'Task creation event should have been received');
    const taskId = createdTask.id;

    // Now, issue the cancel request
    const cancelResponse = await handler.cancelTask({ id: taskId }, serverCallContext);

    // Let the executor's loop run to completion to detect the cancellation
    await clock.runAllAsync();

    assert.isTrue(cancellableExecutor.cancelTaskSpy.calledOnceWith(taskId, sinon.match.any));

    const finalTask = await handler.getTask({ id: taskId }, serverCallContext);
    assert.equal(finalTask.status.state, 'canceled');

    assert.equal(cancelResponse.status.state, 'canceled');
  });

  it('cancelTask: should fail when it fails to cancel a task', async () => {
    clock = sinon.useFakeTimers();
    // Use the more advanced mock for this specific test
    const failingCancellableExecutor = new FailingCancellableMockAgentExecutor(clock);

    handler = new DefaultRequestHandler(
      testAgentCard,
      mockTaskStore,
      failingCancellableExecutor,
      executionEventBusManager
    );

    const streamParams: MessageSendParams = {
      message: createTestMessage('msg-9', 'Start and cancel'),
    };
    const streamGenerator = handler.sendMessageStream(streamParams, serverCallContext);

    const streamEvents: any[] = [];
    (async () => {
      for await (const event of streamGenerator) {
        streamEvents.push(event);
      }
    })();

    // Allow the task to be created and enter the 'working' state
    await clock.tickAsync(150);

    const createdTask = streamEvents.find((e) => e.kind === 'task') as Task;
    assert.isDefined(createdTask, 'Task creation event should have been received');
    const taskId = createdTask.id;

    let cancelResponse: Task;
    let thrownError: any;
    try {
      cancelResponse = await handler.cancelTask({ id: taskId }, serverCallContext);
    } catch (error: any) {
      thrownError = error;
    } finally {
      assert.isDefined(thrownError);
      assert.isUndefined(cancelResponse);
      assert.equal(thrownError.code, -32002);
      expect(thrownError.message).to.contain('Task not cancelable');
      assert.isTrue(
        failingCancellableExecutor.cancelTaskSpy.calledOnceWith(taskId, sinon.match.any)
      );
    }
  });

  it('cancelTask: should fail for tasks in a terminal state', async () => {
    const taskId = 'task-terminal';
    const fakeTask: Task = {
      id: taskId,
      contextId: 'ctx-terminal',
      status: { state: 'completed' },
      kind: 'task',
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    try {
      await handler.cancelTask({ id: taskId }, serverCallContext);
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
        status: { state: 'submitted' },
        kind: 'task',
      });
      bus.finished();
    });
    await handler.sendMessage(params, serverCallContext);
    expect(capturedContextId).to.equal('incoming-ctx-id');
  });

  it('should use contextId from task if not present in incomingMessage (contextId assignment logic)', async () => {
    const taskId = 'task-ctx-id';
    const taskContextId = 'task-context-id';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: taskContextId,
        status: { state: 'working' },
        kind: 'task',
      },
      serverCallContext
    );
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
        status: { state: 'submitted' },
        kind: 'task',
      });
      bus.finished();
    });
    await handler.sendMessage(params, serverCallContext);
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
        status: { state: 'submitted' },
        kind: 'task',
      });
      bus.finished();
    });
    await handler.sendMessage(params, serverCallContext);
    expect(capturedContextId).to.be.a('string').and.not.empty;
  });

  it('ExecutionEventQueue should be instantiable and return an object', () => {
    const fakeBus = {
      on: () => {},
      off: () => {},
    } as any;
    const queue = new ExecutionEventQueue(fakeBus);
    expect(queue).to.be.instanceOf(ExecutionEventQueue);
  });

  it('should pass a RequestContext with expected content to agentExecutor.execute', async () => {
    const messageId = 'msg-expected-ctx';
    const userMessageText = 'Verify RequestContext content.';
    const incomingContextId = 'custom-context-id';
    const incomingTaskId = 'custom-task-id';
    const expectedExtension = 'requested-extension-uri';

    const params: MessageSendParams = {
      message: {
        messageId: messageId,
        role: 'user',
        parts: [{ kind: 'text', text: userMessageText }],
        kind: 'message',
        contextId: incomingContextId,
        taskId: incomingTaskId,
      },
    };

    let capturedRequestContext: RequestContext | undefined;
    (mockAgentExecutor.execute as SinonStub).callsFake(
      async (ctx: RequestContext, bus: ExecutionEventBus) => {
        capturedRequestContext = ctx;
        bus.publish({
          id: ctx.taskId,
          contextId: ctx.contextId,
          status: { state: 'submitted' },
          kind: 'task',
        });
        bus.finished();
      }
    );

    const fakeTask: Task = {
      id: params.message.taskId!,
      contextId: params.message.contextId!,
      status: { state: 'submitted' as TaskState },
      kind: 'task',
    };
    await mockTaskStore.save(fakeTask, serverCallContext);
    await handler.sendMessage(
      params,
      new ServerCallContext(
        [expectedExtension, 'not-available-extension-by-agent-card'],
        new UnauthenticatedUser()
      )
    );

    expect(capturedRequestContext).to.be.instanceOf(
      RequestContext,
      'Captured context should be an instance of RequestContext'
    );
    expect(capturedRequestContext?.userMessage.messageId).to.equal(
      messageId,
      'userMessage.messageId should match'
    );
    expect(capturedRequestContext?.taskId).to.equal(incomingTaskId, 'taskId should match');
    expect(capturedRequestContext?.contextId).to.equal(incomingContextId, 'contextId should match');
    expect(capturedRequestContext?.context?.requestedExtensions).to.deep.equal(
      [expectedExtension],
      'requestedExtensions should contain the expected extension'
    );
    expect(capturedRequestContext?.context?.user).to.be.an.instanceOf(UnauthenticatedUser);
  });

  describe('getAuthenticatedExtendedAgentCard tests', async () => {
    class A2AUser implements User {
      constructor(private _isAuthenticated: boolean) {}

      get isAuthenticated(): boolean {
        return this._isAuthenticated;
      }

      get userName(): string {
        return 'test-user';
      }
    }

    const extendedAgentcardProvider: ExtendedAgentCardProvider = async (context?) => {
      if (context?.user?.isAuthenticated) {
        return extendedAgentCard;
      }
      // Remove the extensions that are not allowed for unauthenticated clients
      extendedAgentCard.capabilities.extensions = [{ uri: 'requested-extension-uri' }];
      return extendedAgentCard;
    };

    const agentCardWithExtendedSupport: AgentCard = {
      name: 'Test Agent',
      description: 'An agent for testing purposes',
      url: 'http://localhost:8080',
      version: '1.0.0',
      protocolVersion: '0.3.0',
      capabilities: {
        extensions: [{ uri: 'requested-extension-uri' }],
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
      supportsAuthenticatedExtendedCard: true,
    };

    const extendedAgentCard: AgentCard = {
      name: 'Test ExtendedAgentCard Agent',
      description: 'An agent for testing the extended agent card functionality',
      url: 'http://localhost:8080',
      version: '1.0.0',
      protocolVersion: '0.3.0',
      capabilities: {
        extensions: [
          { uri: 'requested-extension-uri' },
          { uri: 'extension-uri-for-authenticated-clients' },
        ],
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

    it('getAuthenticatedExtendedAgentCard should fail if the agent card does not support extended agent card', async () => {
      let caughtError;
      try {
        await handler.getAuthenticatedExtendedAgentCard();
      } catch (error: any) {
        caughtError = error;
      } finally {
        expect(caughtError).to.be.instanceOf(A2AError);
        expect(caughtError.code).to.equal(-32004);
        expect(caughtError.message).to.contain('Unsupported operation');
      }
    });

    it('getAuthenticatedExtendedAgentCard should fail if ExtendedAgentCardProvider is not provided', async () => {
      handler = new DefaultRequestHandler(
        agentCardWithExtendedSupport,
        mockTaskStore,
        mockAgentExecutor,
        executionEventBusManager
      );
      let caughtError;
      try {
        await handler.getAuthenticatedExtendedAgentCard();
      } catch (error: any) {
        caughtError = error;
      } finally {
        expect(caughtError).to.be.instanceOf(A2AError);
        expect(caughtError.code).to.equal(-32007);
        expect(caughtError.message).to.contain('Extended card not configured');
      }
    });

    it('getAuthenticatedExtendedAgentCard should return extended card if user is authenticated with ExtendedAgentCardProvider as AgentCard', async () => {
      handler = new DefaultRequestHandler(
        agentCardWithExtendedSupport,
        mockTaskStore,
        mockAgentExecutor,
        executionEventBusManager,
        undefined,
        undefined,
        extendedAgentCard
      );

      const context = new ServerCallContext(undefined, new A2AUser(true));
      const agentCard = await handler.getAuthenticatedExtendedAgentCard(context);
      assert.deepEqual(agentCard, extendedAgentCard);
    });

    it('getAuthenticatedExtendedAgentCard should return capped extended card if user is not authenticated with ExtendedAgentCardProvider as callback', async () => {
      handler = new DefaultRequestHandler(
        agentCardWithExtendedSupport,
        mockTaskStore,
        mockAgentExecutor,
        executionEventBusManager,
        undefined,
        undefined,
        extendedAgentcardProvider
      );

      const context = new ServerCallContext(undefined, new A2AUser(false));
      const agentCard = await handler.getAuthenticatedExtendedAgentCard(context);
      assert(agentCard.capabilities.extensions.length === 1);
      assert.deepEqual(agentCard.capabilities.extensions[0], { uri: 'requested-extension-uri' });
      assert.deepEqual(agentCard.name, extendedAgentCard.name);
    });
  });
});

import { describe, it, beforeEach, afterEach, assert, expect, vi, type Mock } from 'vitest';

import { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';
import {
  TaskNotFoundError,
  PushNotificationNotSupportedError,
  UnsupportedOperationError,
  RequestMalformedError,
  TaskNotCancelableError,
  AuthenticatedExtendedCardNotConfiguredError,
} from '../../src/errors.js';
import {
  TaskStore,
  InMemoryTaskStore,
  DefaultRequestHandler,
  ExecutionEventQueue,
  InMemoryPushNotificationStore,
  RequestContext,
  ExecutionEventBus,
  UnauthenticatedUser,
  ExtendedAgentCardProvider,
  User,
} from '../../src/server/index.js';
import {
  AgentCard,
  Task,
  TaskState,
  GetTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigsRequest,
  SendMessageRequest,
  Role,
  TaskStatusUpdateEvent,
  DeleteTaskPushNotificationConfigRequest,
  TaskPushNotificationConfig,
  Message,
  Artifact,
  SendMessageConfiguration,
} from '../../src/types/pb/a2a.js';
type TextPart = { $case: 'text'; value: string };
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

  const testAgentCard = {
    name: 'Test Agent',
    description: 'An agent for testing purposes',
    provider: { url: '', organization: '' }, iconUrl: undefined, supportedInterfaces: [] as any[],
    version: '1.0.0',
    documentationUrl: '',    capabilities: {
      extensions: [
        {
          uri: 'requested-extension-uri',
          description: 'description',
          required: false,
          params: {},
        },
      ],
      streaming: true,
      pushNotifications: true,
    },
    securitySchemes: {},
    securityRequirements: [] as any[],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A skill for testing',
        tags: ['test'],
        examples: [] as any[],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
        securityRequirements: [] as any[],
      },
    ],    signatures: [] as any[],
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

  // After each test, restore any mocks
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Helper function to create a basic user message
  const createTestMessage = (id: string, text: string): Message => ({
    messageId: id,
    role: Role.ROLE_USER,
    parts: [{ content: { $case: 'text', value: text }, metadata: {}, filename: '', mediaType: 'text/plain' }],
    taskId: '',
    contextId: '',
    extensions: [] as any[],
    metadata: {},
    
  });

  it('sendMessage: should return a simple message response', async () => {
    const params: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-1', 'Hello'),
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;

    const agentResponse: Message = {
      messageId: 'agent-msg-1',
      role: Role.ROLE_AGENT,
      parts: [{ content: { $case: 'text', value: 'Hi there!' }, metadata: {}, filename: '', mediaType: 'text/plain' }],
      taskId: 'task-msg-1',
      contextId: '',
      extensions: [] as any[],
      metadata: {},
      
    };

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      // Publish task creation event so ResultManager creates the task
      bus.publish({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      });
      const responseWithTaskId = { ...agentResponse, taskId: ctx.taskId };
      bus.publish(responseWithTaskId);
      bus.finished();
    });

    const result = (await handler.sendMessage(params, serverCallContext)) as Message;

    // Not comparing the taskId as it is assigned by the handler
    assert.deepEqual(result, { ...agentResponse, taskId: result.taskId });
    expect((mockAgentExecutor as MockAgentExecutor).execute).toHaveBeenCalledTimes(1);
  });

  it('sendMessage: (blocking) should return a task in a completed state with an artifact', async () => {
    const params: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-2', 'Do a task'),
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;

    const taskId = 'task-123';
    const contextId = 'ctx-abc';
    const testArtifact: Artifact = {
      artifactId: 'artifact-1',
      name: 'Test Document',
      description: 'A test artifact.',
      parts: [{ content: { $case: 'text', value: 'This is the content of the artifact.' }, metadata: {}, filename: '', mediaType: 'text/plain' }],
      metadata: {}, 
      extensions: [] as any[],
    };

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      });
      bus.publish({
        taskId,
        contextId,

        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },        metadata: {}, 
      });
      bus.publish({
        taskId,
        contextId,

        artifact: testArtifact,
        append: false,
        lastChunk: true,
        metadata: {}
      });
      bus.publish({
        taskId,
        contextId,

        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: undefined,
          message: {
            role: Role.ROLE_AGENT,
            parts: [{ content: { $case: 'text', value: 'Done!' }, metadata: {}, filename: '', mediaType: 'text/plain' }],
            messageId: 'agent-msg-2',
            taskId,
            contextId,
            extensions: [] as any[],
            metadata: {}, referenceTaskIds: []
          },
        },        metadata: {}, 
      });
      bus.finished();
    });

    const result = await handler.sendMessage(params, serverCallContext);
    const taskResult = result as Task;

    assert.equal(taskResult.id, taskId);
    assert.equal(taskResult.status.state, TaskState.TASK_STATE_COMPLETED);
    assert.isDefined(taskResult.artifacts, 'Task result should have artifacts');
    assert.isArray(taskResult.artifacts);
    assert.lengthOf(taskResult.artifacts!, 1);
    assert.deepEqual(taskResult.artifacts![0], testArtifact);
  });

  it('sendMessage: should handle agent execution failure for blocking calls', async () => {
    const errorMessage = 'Agent failed!';
    (mockAgentExecutor as MockAgentExecutor).execute.mockRejectedValue(new Error(errorMessage));

    // Test blocking case (returnImmediately = false or undefined)
    const blockingParams: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-fail-block', 'Test failure blocking'),
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;

    const blockingResult = await handler.sendMessage(blockingParams, serverCallContext);
    const blockingTask = blockingResult as Task;

    assert.equal(
      blockingTask.status.state,
      TaskState.TASK_STATE_FAILED,
      'Task status should be failed'
    );
    assert.include(
      (blockingTask.status.message?.content[0].part as any).value,
      errorMessage,
      'Error message should be in the status'
    );
  });

  it('sendMessage: (non-blocking) should return first task event immediately and process full task in background', async () => {
    vi.useFakeTimers();
    const saveSpy = vi.spyOn(mockTaskStore, 'save');

    const params: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-nonblock', 'Do a long task'),
      configuration: { returnImmediately: true, acceptedOutputModes: [] } as SendMessageConfiguration,
      metadata: {}, 
    } as SendMessageRequest;

    const taskId = 'task-nonblock-123';
    const contextId = 'ctx-nonblock-abc';

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      // First event is the task creation, which should be returned immediately
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      });

      // Simulate work before publishing more events
      await vi.advanceTimersByTimeAsync(500);

      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },        metadata: {}, 
      });
      bus.finished();
    });

    // This call should return as soon as the first 'task' event is published
    const immediateResult = await handler.sendMessage(params, serverCallContext);

    // Assert that we got the initial task object back right away
    const taskResult = immediateResult as Task;

    assert.equal(taskResult.id, taskId);
    assert.equal(
      taskResult.status.state,
      TaskState.TASK_STATE_SUBMITTED,
      'Should return immediately with TaskState.TASK_STATE_SUBMITTED state'
    );

    // The background processing should not have completed yet
    expect(saveSpy).toHaveBeenCalledTimes(1);
    assert.equal(saveSpy.mock.calls[0][0].status.state, TaskState.TASK_STATE_SUBMITTED);

    // Allow the background processing to complete
    await vi.runAllTimersAsync();

    // Now, check the final state in the store to ensure background processing finished
    const finalTask = await mockTaskStore.load(taskId, serverCallContext);
    assert.isDefined(finalTask);
    assert.equal(
      finalTask!.status.state,
      TaskState.TASK_STATE_COMPLETED,
      'Task should be TaskState.TASK_STATE_COMPLETED in the store after background processing'
    );
    expect(saveSpy).toHaveBeenCalledTimes(2);
    assert.equal(saveSpy.mock.calls[1][0].status.state, TaskState.TASK_STATE_COMPLETED);
  });

  it('sendMessage: (non-blocking) should handle failure in event loop after successfull task event', async () => {
    vi.useFakeTimers();

    const mockTaskStore = new MockTaskStore();
    const handler = new DefaultRequestHandler(
      testAgentCard,
      mockTaskStore,
      mockAgentExecutor,
      executionEventBusManager
    );

    const params: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-nonblock', 'Do a long task'),
      configuration: {
        returnImmediately: true,
        acceptedOutputModes: [] as any[],
      },
      metadata: {}, 
    } as SendMessageRequest;

    const taskId = 'task-nonblock-123';
    const contextId = 'ctx-nonblock-abc';
    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      // First event is the task creation, which should be returned immediately
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      });

      // Simulate work before publishing more events
      await vi.advanceTimersByTimeAsync(500);

      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },        metadata: {}, 
      });
      bus.finished();
    });

    let finalTaskSaved: Task | undefined;
    const errorMessage = 'Error thrown on saving completed task notification';
    (mockTaskStore as MockTaskStore).save.mockImplementation(async (task) => {
      if (task.status.state == TaskState.TASK_STATE_COMPLETED) {
        throw new Error(errorMessage);
      }

      if (task.status.state == TaskState.TASK_STATE_FAILED) {
        finalTaskSaved = task;
      }
    });

    // This call should return as soon as the first 'task' event is published
    const immediateResult = await handler.sendMessage(params, serverCallContext);

    // Assert that we got the initial task object back right away
    const taskResult = immediateResult as Task;

    assert.equal(taskResult.id, taskId);
    assert.equal(
      taskResult.status.state,
      TaskState.TASK_STATE_SUBMITTED,
      'Should return immediately with TaskState.TASK_STATE_SUBMITTED state'
    );

    // Allow the background processing to complete
    await vi.runAllTimersAsync();

    assert.equal(finalTaskSaved!.status.state, TaskState.TASK_STATE_FAILED);
    assert.equal(finalTaskSaved!.id, taskId);
    assert.equal(finalTaskSaved!.contextId, contextId);
    assert.equal(finalTaskSaved!.status.message!.role, Role.ROLE_AGENT);
    assert.equal(
      (finalTaskSaved!.status.message!.content[0].part as TextPart).value,
      `Event processing loop failed: ${errorMessage}`
    );
  });

  it('sendMessage: should handle agent execution failure for non-blocking calls', async () => {
    const errorMessage = 'Agent failed!';
    (mockAgentExecutor as MockAgentExecutor).execute.mockRejectedValue(new Error(errorMessage));

    // Test non-blocking case
    const nonBlockingParams: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-fail-nonblock', 'Test failure non-blocking'),
      configuration: { returnImmediately: true, acceptedOutputModes: [] } as SendMessageConfiguration,
      metadata: {}, 
    } as SendMessageRequest;

    const nonBlockingResult = await handler.sendMessage(nonBlockingParams, serverCallContext);
    const nonBlockingTask = nonBlockingResult as Task;

    assert.equal(
      nonBlockingTask.status.state,
      TaskState.TASK_STATE_FAILED,
      'Task status should be failed'
    );
    assert.include(
      (nonBlockingTask.status.message?.content[0].part as any).value,
      errorMessage,
      'Error message should be in the status'
    );
  });

  it('sendMessage: should return second task with full history if message is sent to an existing, non-terminal task', async () => {
    const contextId = 'ctx-history-abc';

    // First message
    const firstMessage = createTestMessage('msg-1', 'Message 1');
    firstMessage.contextId = contextId;
    const firstParams: SendMessageRequest = {
      tenant: '',
      message: firstMessage,
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;

    let taskId: string;

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      taskId = ctx.taskId;

      // Publish task creation
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      });

      // Publish working status
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },        metadata: {}, 
      });

      // Mark as input-required with agent response message
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_INPUT_REQUIRED,
          timestamp: undefined,
          message: {
            messageId: 'agent-msg-1',
            role: Role.ROLE_AGENT,
            parts: [{ content: { $case: 'text', value: 'Response to message 1' }, metadata: {}, filename: '', mediaType: 'text/plain' }],
            taskId,
            contextId,
            extensions: [] as any[],
            metadata: {}, referenceTaskIds: []
          },
        },        metadata: {}, 
      });
      bus.finished();
    });

    const firstResult = await handler.sendMessage(firstParams, serverCallContext);
    const firstTask = firstResult as Task;
    assert.equal(firstTask.status.state, TaskState.TASK_STATE_INPUT_REQUIRED);

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

    const secondParams: SendMessageRequest = {
      tenant: '',
      message: secondMessage,
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      // Publish a status update with working state
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },        metadata: {}, 
      });

      // Publish a status update with working state and message
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          timestamp: undefined,
          message: {
            messageId: 'agent-msg-2',
            role: Role.ROLE_AGENT,
            parts: [{ content: { $case: 'text', value: 'Response to message 2' }, metadata: {}, filename: '', mediaType: 'text/plain' }],
            taskId,
            contextId,
            extensions: [] as any[],
            metadata: {}, referenceTaskIds: []
          },
        },        metadata: {}, 
      });

      // Publish an artifact update
      bus.publish({
        taskId,
        contextId,
        artifact: {
          id: 'artifact-1',
          name: 'Test Document',
          description: 'A test artifact.',
          parts: [{ content: { $case: 'text', value: 'This is the content of the artifact.' }, metadata: {}, filename: '', mediaType: 'text/plain' }],
          metadata: {},
          extensions: [] as any[],
        },
        append: false,
        lastChunk: true,
        metadata: {}
      });

      // Mark as completed
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: undefined,
          message: undefined,
        },        metadata: {}, 
      });

      bus.finished();
    });

    const secondResult = await handler.sendMessage(secondParams, serverCallContext);
    const secondTask = secondResult as Task;
    assert.equal(secondTask.id, taskId, 'Should be the same task');
    assert.equal(secondTask.status.state, TaskState.TASK_STATE_COMPLETED);

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
    assert.equal((secondTask.history![0].content[0].part as any).value, 'Message 1');
    assert.equal(
      secondTask.history![1].messageId,
      'agent-msg-1',
      'Second message should be first agent message'
    );
    assert.equal((secondTask.history![1].content[0].part as any).value, 'Response to message 1');
    assert.equal(
      secondTask.history![2].messageId,
      'msg-2',
      'Third message should be second user message'
    );
    assert.equal((secondTask.history![2].content[0].part as any).value, 'Message 2');
    assert.equal(
      secondTask.history![3].messageId,
      'agent-msg-2',
      'Fourth message should be second agent message'
    );
    assert.equal((secondTask.history![3].content[0].part as any).value, 'Response to message 2');
    assert.equal(secondTask.artifacts![0].id, 'artifact-1', 'Artifact should be the same');
    assert.equal(secondTask.artifacts![0].name, 'Test Document', 'Artifact name should be the same');
    assert.equal(
      secondTask.artifacts![0].description,
      'A test artifact.',
      'Artifact description should be the same'
    );
    assert.equal(
      (secondTask.artifacts![0].parts[0].part as any).value,
      'This is the content of the artifact.',
      'Artifact content should be the same'
    );
  });

  it('sendMessage: should return second task with full history if message is sent to an existing, non-terminal task, in non-blocking mode', async () => {
    const contextId = 'ctx-history-abc';
    vi.useFakeTimers();

    // First message
    const firstMessage = createTestMessage('msg-1', 'Message 1');
    firstMessage.contextId = contextId;
    const firstParams: SendMessageRequest = {
      tenant: '',
      message: firstMessage,
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;

    let taskId: string;

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      taskId = ctx.taskId;

      // Publish task creation
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      });

      // Publish working status
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },        metadata: {}, 
      });

      // Mark as input-required with agent response message
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_INPUT_REQUIRED,
          timestamp: undefined,
          message: {
            messageId: 'agent-msg-1',
            role: Role.ROLE_AGENT,
            parts: [{ content: { $case: 'text', value: 'Response to message 1' }, metadata: {}, filename: '', mediaType: 'text/plain' }],
            taskId,
            contextId,
            extensions: [] as any[],
            metadata: {}, referenceTaskIds: []
          },
        },        metadata: {}, 
      });
      bus.finished();
    });

    const firstResult = await handler.sendMessage(firstParams, serverCallContext);
    const firstTask = firstResult as Task;

    // Check the first result is a task with `input-required` status
    assert.equal(firstTask.status.state, TaskState.TASK_STATE_INPUT_REQUIRED);

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

    const secondParams: SendMessageRequest = {
      tenant: '',
      metadata: {}, 
      message: secondMessage,
      configuration: { returnImmediately: true } as SendMessageConfiguration,
    };

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      // Publish a status update with working state
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },        metadata: {}, 
      });

      await vi.advanceTimersByTimeAsync(10);

      // Publish a status update with working state and message
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          timestamp: undefined,
          message: {
            messageId: 'agent-msg-2',
            role: Role.ROLE_AGENT,
            parts: [{ content: { $case: 'text', value: 'Response to message 2' }, metadata: {}, filename: '', mediaType: 'text/plain' }],
            taskId,
            contextId,
            extensions: [] as any[],
            metadata: {}, referenceTaskIds: []
          },
        },        metadata: {}, 
      });

      // Publish an artifact update
      bus.publish({
        taskId,
        contextId,
        artifact: {
          id: 'artifact-1',
          name: 'Test Document',
          description: 'A test artifact.',
          parts: [{ content: { $case: 'text', value: 'This is the content of the artifact.' }, metadata: {}, filename: '', mediaType: 'text/plain' }],
          metadata: {},
          extensions: [] as any[],
        },
        append: false,
        lastChunk: true,
        metadata: {}
      });

      // Mark as completed
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: undefined,
          message: undefined,
        },        metadata: {}, 
      });

      bus.finished();
    });

    const secondResult = await handler.sendMessage(secondParams, serverCallContext);

    // Check the second result is a task with `completed` status
    const secondTask = secondResult as Task;

    assert.equal(secondTask.id, taskId, 'Should be the same task');
    assert.equal(secondTask.status.state, TaskState.TASK_STATE_WORKING); // It will receive the Task in the status of the first published event

    await vi.runAllTimersAsync(); // give time to the second task to publish all the updates

    const finalTask = await mockTaskStore.load(taskId, serverCallContext);

    // Check the history
    assert.equal(finalTask.status.state, TaskState.TASK_STATE_COMPLETED);
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
    assert.equal((finalTask.history![0].content[0].part as any).value, 'Message 1');
    assert.equal(
      finalTask.history![1].messageId,
      'agent-msg-1',
      'Second message should be first agent message'
    );
    assert.equal((finalTask.history![1].content[0].part as any).value, 'Response to message 1');
    assert.equal(
      finalTask.history![2].messageId,
      'msg-2',
      'Third message should be second user message'
    );
    assert.equal((finalTask.history![2].content[0].part as any).value, 'Message 2');
    assert.equal(
      finalTask.history![3].messageId,
      'agent-msg-2',
      'Fourth message should be second agent message'
    );
    assert.equal((finalTask.history![3].content[0].part as any).value, 'Response to message 2');
    assert.equal(finalTask.artifacts![0].id, 'artifact-1', 'Artifact should be the same');
    assert.equal(finalTask.artifacts![0].name, 'Test Document', 'Artifact name should be the same');
    assert.equal(
      finalTask.artifacts![0].description,
      'A test artifact.',
      'Artifact description should be the same'
    );
    assert.equal(
      (finalTask.artifacts![0].parts[0].part as any).value,
      'This is the content of the artifact.',
      'Artifact content should be the same'
    );
  });

  it('sendMessageStream: should stream submitted, working, and completed events', async () => {
    const params: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-3', 'Stream a task'),
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;
    const taskId = 'task-stream-1';
    const contextId = 'ctx-stream-1';

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      });
      await new Promise((res) => setTimeout(res, 10));
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },        metadata: {}, 
      });
      await new Promise((res) => setTimeout(res, 10));
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },        metadata: {}, 
      });
      bus.finished();
    });

    const eventGenerator = handler.sendMessageStream(params, serverCallContext);
    const events = [];
    for await (const event of eventGenerator) {
      events.push(event);
    }

    assert.lengthOf(events, 3, 'Stream should yield 3 events');
    assert.equal((events[0] as Task).status.state, TaskState.TASK_STATE_SUBMITTED);
    assert.equal((events[1] as TaskStatusUpdateEvent).status.state, TaskState.TASK_STATE_WORKING);
    assert.equal((events[2] as TaskStatusUpdateEvent).status.state, TaskState.TASK_STATE_COMPLETED);
    assert.isTrue((events[2] as TaskStatusUpdateEvent).final);
  });

  it('sendMessage: should reject if task is in a terminal state', async () => {
    const taskId = 'task-terminal-1';
    const terminalStates: TaskState[] = [
      TaskState.TASK_STATE_COMPLETED,
      TaskState.TASK_STATE_FAILED,
      TaskState.TASK_STATE_CANCELED,
      TaskState.TASK_STATE_REJECTED,
    ];

    for (const state of terminalStates) {
      const fakeTask: Task = {
        id: taskId,
        contextId: 'ctx-terminal',
        status: { state: state as TaskState, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      };
      await mockTaskStore.save(fakeTask, serverCallContext);

      const params: SendMessageRequest = {
        tenant: '',
        message: { ...createTestMessage('msg-1', 'test'), taskId: taskId },
        configuration: undefined,
        metadata: {}, 
      } as SendMessageRequest;

      try {
        await handler.sendMessage(params, serverCallContext);
        assert.fail(`Should have thrown for state: ${state}`);
      } catch (error: any) {
        expect(error).to.be.instanceOf(RequestMalformedError);
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
      status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
      artifacts: [] as any[],
      metadata: {}, 
      history: [] as any[],
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    const params: SendMessageRequest = {
      tenant: '',
      message: { ...createTestMessage('msg-1', 'test'), taskId: taskId },
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;

    const generator = handler.sendMessageStream(params, serverCallContext);

    try {
      await generator.next();
      assert.fail('sendMessageStream should have thrown an error');
    } catch (error: any) {
      expect(error).to.be.instanceOf(RequestMalformedError);
      expect(error.message).toContain(`Task ${taskId} is in a terminal state`);
    }
  });

  it('sendMessageStream: should stop at input-required state', async () => {
    const params: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-4', 'I need input'),
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;
    const taskId = 'task-input';
    const contextId = 'ctx-input';

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      });
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_INPUT_REQUIRED,
          message: undefined,
          timestamp: undefined,
        },        metadata: {}, 
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
    assert.equal(lastEvent.status.state, TaskState.TASK_STATE_INPUT_REQUIRED);
    assert.isTrue(lastEvent.final);
  });

  it('resubscribe: should allow multiple clients to receive events for the same task', async () => {
    const saveSpy = vi.spyOn(mockTaskStore, 'save');
    vi.useFakeTimers();
    const params: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-5', 'Long running task'),
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;

    let taskId;
    let contextId;

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      taskId = ctx.taskId;
      contextId = ctx.contextId;

      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      });
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },        metadata: {}, 
      });
      await vi.advanceTimersByTimeAsync(100);
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },        metadata: {}, 
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

    const stream2_generator = handler.resubscribe({ id: taskId, tenant: '' }, serverCallContext);

    const results1: any[] = [firstEvent, secondEvent];
    const results2: any[] = [];

    const collect = async (iterator: AsyncGenerator<any>, results: any[]) => {
      for await (const res of iterator) {
        results.push(res);
      }
    };

    const p1 = collect(stream1_iterator, results1);
    const p2 = collect(stream2_generator, results2);

    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    assert.equal(
      (results1[0] as TaskStatusUpdateEvent).status.state,
      TaskState.TASK_STATE_SUBMITTED
    );
    assert.equal((results1[1] as TaskStatusUpdateEvent).status.state, TaskState.TASK_STATE_WORKING);
    assert.equal(
      (results1[2] as TaskStatusUpdateEvent).status.state,
      TaskState.TASK_STATE_COMPLETED
    );

    // First event of resubscribe is always a task.
    assert.equal((results2[0] as Task).status.state, TaskState.TASK_STATE_WORKING);
    assert.equal(
      (results2[1] as TaskStatusUpdateEvent).status.state,
      TaskState.TASK_STATE_COMPLETED
    );

    expect(saveSpy).toHaveBeenCalledTimes(3);
    const lastSaveCall = saveSpy.mock.calls[saveSpy.mock.calls.length - 1][0];
    assert.equal(lastSaveCall.id, taskId);
    assert.equal(lastSaveCall.status.state, TaskState.TASK_STATE_COMPLETED);
  });

  it('getTask: should return an existing task from the store', async () => {
    const fakeTask: Task = {
      id: 'task-exist',
      contextId: 'ctx-exist',
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
      artifacts: [] as any[],
      metadata: {}, 
      history: [] as any[],
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    const result = await handler.getTask(
      { id: fakeTask.id, tenant: '', historyLength: 0 },
      serverCallContext
    );
    assert.deepEqual(result, fakeTask);
  });

  it('set/getTaskPushNotificationConfig: should save and retrieve config', async () => {
    const taskId = 'task-push-config';
    const fakeTask: Task = {
      id: taskId,
      contextId: 'ctx-push',
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
      artifacts: [] as any[],
      metadata: {}, 
      history: [] as any[],
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    const pushConfig: TaskPushNotificationConfig = {
      taskId,
      id: 'config-1',
      url: 'https://example.com/notify',
      token: 'secret-token',
      authentication: undefined,
      tenant: '',
    };

    const setResponse = await handler.setTaskPushNotificationConfig(pushConfig, serverCallContext);
    assert.deepEqual(
      setResponse,
      pushConfig,
      'Set response should return the config'
    );

    const getParams: GetTaskPushNotificationConfigRequest = {
      taskId,
      id: 'config-1',
      tenant: '',
    };
    const getResponse = await handler.getTaskPushNotificationConfig(getParams, serverCallContext);
    assert.deepEqual(
      getResponse,
      pushConfig,
      'Get response should return the saved config'
    );
  });

  it('setTaskPushNotificationConfig: should overwrite an existing config with the same ID', async () => {
    const taskId = 'task-overwrite';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-overwrite',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
        artifacts: [] as any[],
        history: [] as any[],
      },
      serverCallContext
    );
    const initialConfig: TaskPushNotificationConfig = {
      taskId,
      id: 'config-same',
      url: 'https://initial.url',
      token: 'token-same',
      authentication: undefined,
      tenant: '',
    };
    await handler.setTaskPushNotificationConfig(
      initialConfig,
      serverCallContext
    );

    const newConfig: TaskPushNotificationConfig = {
      taskId,
      id: 'config-same',
      url: 'https://new.url',
      token: 'token-new',
      authentication: undefined,
      tenant: '',
    };
    await handler.setTaskPushNotificationConfig(
      newConfig,
      serverCallContext
    );

    const configs = await handler.listTaskPushNotificationConfigs(
      {
        taskId,
        tenant: '', pageSize: 0,
        pageToken: '',
      },
      serverCallContext
    );
    expect(configs).to.have.lengthOf(1);
    expect(configs[0].url).to.equal('https://new.url');
  });

  it('listTaskPushNotificationConfigs: should return all configs for a task', async () => {
    const taskId = 'task-list-configs';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-list',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
        artifacts: [] as any[],
        history: [] as any[],
      },
      serverCallContext
    );
    const config1: TaskPushNotificationConfig = {
      taskId,
      id: 'cfg1',
      url: 'https://url1.com',
      token: 'token-1',
      authentication: undefined,
      tenant: '',
    };
    const config2: TaskPushNotificationConfig = {
      taskId,
      id: 'cfg2',
      url: 'https://url2.com',
      token: 'token-2',
      authentication: undefined,
      tenant: '',
    };
    await handler.setTaskPushNotificationConfig(
      config1,
      serverCallContext
    );
    await handler.setTaskPushNotificationConfig(
      config2,
      serverCallContext
    );

    const listParams: ListTaskPushNotificationConfigsRequest = {
      taskId,
      tenant: '', pageSize: 0,
      pageToken: '',
    };
    const listResponse = await handler.listTaskPushNotificationConfigs(
      listParams,
      serverCallContext
    );

    expect(listResponse).to.be.an('array').with.lengthOf(2);
    assert.deepInclude(listResponse, config1);
    assert.deepInclude(listResponse, config2);
  });

  it('deleteTaskPushNotificationConfig: should remove a specific config', async () => {
    const taskId = 'task-delete-config';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-delete',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
        artifacts: [] as any[],
        history: [] as any[],
      },
      serverCallContext
    );
    const config1: TaskPushNotificationConfig = {
      taskId,
      id: 'cfg-del-1',
      url: 'https://url1.com',
      token: 'token-1',
      authentication: undefined,
      tenant: '',
    };
    const config2: TaskPushNotificationConfig = {
      taskId,
      id: 'cfg-del-2',
      url: 'https://url2.com',
      token: 'token-2',
      authentication: undefined,
      tenant: '',
    };
    await handler.setTaskPushNotificationConfig(
      config1,
      serverCallContext
    );
    await handler.setTaskPushNotificationConfig(
      config2,
      serverCallContext
    );

    const deleteParams: DeleteTaskPushNotificationConfigRequest = {
      taskId,
      id: 'cfg-del-1',
      tenant: '',
    };
    await handler.deleteTaskPushNotificationConfig(deleteParams, serverCallContext);

    const remainingConfigs = await handler.listTaskPushNotificationConfigs(
      {
        taskId,
        tenant: '', pageSize: 0,
        pageToken: '',
      },
      serverCallContext
    );
    expect(remainingConfigs).to.have.lengthOf(1);
    expect(remainingConfigs[0].id).to.equal('cfg-del-2');
  });

  it('deleteTaskPushNotificationConfig: should remove the whole entry if last config is deleted', async () => {
    const taskId = 'task-delete-last-config';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-delete-last',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
        artifacts: [] as any[],
        history: [] as any[],
      },
      serverCallContext
    );
    const config: TaskPushNotificationConfig = {
      taskId,
      id: 'cfg-last',
      url: 'https://last.com',
      token: 'token-last',
      authentication: undefined,
      tenant: '',
    };
    await handler.setTaskPushNotificationConfig(
      config,
      serverCallContext
    );

    await handler.deleteTaskPushNotificationConfig(
      {
        taskId,
        id: 'cfg-last',
        tenant: '',
      },
      serverCallContext
    );

    const configs = await handler.listTaskPushNotificationConfigs(
      {
        taskId,
        tenant: '', pageSize: 0,
        pageToken: '',
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
    const taskTaskPushNotificationConfig: TaskPushNotificationConfig = {
      taskId: 'task-id-will-be-set-later', // Placeholder, will be updated in handler
      url: 'https://push-1.com',
      id: 'push-1',
      token: 'token-1',
      authentication: undefined,
      tenant: '',
    };
    const contextId = 'ctx-push-1';

    const params: SendMessageRequest = {
      tenant: '',
      metadata: {}, 
      message: {
        ...createTestMessage('msg-push-1', 'Work on task with push notification'),
        contextId: contextId,
      },
      configuration: {
        taskTaskPushNotificationConfig,
      } as SendMessageConfiguration,
    };

    let taskId: string;
    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      taskId = ctx.taskId;
      fakeTaskExecute(ctx, bus);
    });

    await handler.sendMessage(params, serverCallContext);

    const expectedTask: Task = {
      id: taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
      artifacts: [] as any[],
      metadata: {},
      history: [params.message as Message],
    };

    // Verify push notifications were sent with complete task objects
    expect((mockPushNotificationSender as MockPushNotificationSender).send).toHaveBeenCalledTimes(
      3
    );

    // Verify first call (submitted state)
    const firstCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[0][0] as Task;
    const expectedFirstTask: Task = {
      ...expectedTask,
      status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
    };
    assert.deepEqual(firstCallTask, expectedFirstTask);

    // // Verify second call (working state)
    const secondCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[1][0] as Task;
    const expectedSecondTask: Task = {
      ...expectedTask,
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
    };
    assert.deepEqual(secondCallTask, expectedSecondTask);

    // // Verify third call (completed state)
    const thirdCallTask = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[2][0] as Task;
    const expectedThirdTask: Task = {
      ...expectedTask,
      status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
    };
    assert.deepEqual(thirdCallTask, expectedThirdTask);
  });

  it('Push Notification methods should throw error if task does not exist', async () => {
    const nonExistentTaskId = 'task-non-existent';
    const config: TaskPushNotificationConfig = {
      taskId: nonExistentTaskId,
      id: 'cfg-x',
      url: 'https://x.com',
      token: 'token-x',
      authentication: undefined,
      tenant: '',
    };

    const methodsToTest = [
      {
        name: 'setTaskPushNotificationConfig',
        params: config,
      },
      {
        name: 'getTaskPushNotificationConfig',
        params: { taskId: nonExistentTaskId, id: 'cfg-x', tenant: '' },
      },
      {
        name: 'listTaskPushNotificationConfigs',
        params: { taskId: nonExistentTaskId, tenant: '', pageSize: 0, pageToken: '' },
      },
      {
        name: 'deleteTaskPushNotificationConfig',
        params: { taskId: nonExistentTaskId, id: 'cfg-x', tenant: '' },
      },
    ];

    for (const method of methodsToTest) {
      try {
        await (handler as any)[method.name](method.params, serverCallContext);
        assert.fail(`Method ${method.name} should have thrown for non-existent task.`);
      } catch (error: any) {
        expect(error).to.be.instanceOf(TaskNotFoundError);
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
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
        artifacts: [] as any[],
        history: [] as any[],
      },
      serverCallContext
    );
    const config: TaskPushNotificationConfig = {
      taskId,
      id: 'cfg-u',
      url: 'https://u.com',
      token: 'token-u',
      authentication: undefined,
      tenant: '',
    };

    const methodsToTest = [
      {
        name: 'setTaskPushNotificationConfig',
        params: config,
      },
      {
        name: 'getTaskPushNotificationConfig',
        params: { taskId, id: 'cfg-u', tenant: '' },
      },
      {
        name: 'listTaskPushNotificationConfigs',
        params: { taskId, tenant: '', pageSize: 0, pageToken: '' },
      },
      {
        name: 'deleteTaskPushNotificationConfig',
        params: { taskId, id: 'cfg-u', tenant: '' },
      },
    ];

    for (const method of methodsToTest) {
      try {
        await (handler as any)[method.name](method.params);
        assert.fail(`Method ${method.name} should have thrown for unsupported push notifications.`);
      } catch (error: any) {
        expect(error).to.be.instanceOf(PushNotificationNotSupportedError);
      }
    }
  });

  it('cancelTask: should cancel a running task and notify listeners', async () => {
    vi.useFakeTimers();
    // Use the more advanced mock for this specific test
    const cancellableExecutor = new CancellableMockAgentExecutor();
    handler = new DefaultRequestHandler(
      testAgentCard,
      mockTaskStore,
      cancellableExecutor,
      executionEventBusManager
    );

    const streamParams: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-9', 'Start and cancel'),
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;
    const streamGenerator = handler.sendMessageStream(streamParams, serverCallContext);

    const streamEvents: any[] = [];
    (async () => {
      for await (const event of streamGenerator) {
        streamEvents.push(event);
      }
    })();

    // Allow the task to be created and enter the TaskState.TASK_STATE_WORKING state
    await vi.advanceTimersByTimeAsync(25);

    const createdTask = streamEvents.find((e) => 'id' in e) as Task;
    assert.isDefined(createdTask, 'Task creation event should have been received');
    const taskId = createdTask.id;

    // Now, issue the cancel request
    const cancelPromise = handler.cancelTask({ metadata: {}, id: taskId, tenant: '' }, serverCallContext);

    // Let the executor's loop run to completion to detect the cancellation
    await vi.runAllTimersAsync();

    const cancelResponse = await cancelPromise;

    expect(cancellableExecutor.cancelTaskSpy).toHaveBeenCalledExactlyOnceWith(
      taskId,
      expect.anything()
    );

    const finalTask = await handler.getTask(
      { id: taskId, tenant: '', historyLength: 0 },
      serverCallContext
    );
    assert.equal(finalTask.status.state, TaskState.TASK_STATE_CANCELED);

    assert.equal(cancelResponse.status.state, TaskState.TASK_STATE_CANCELED);
  });

  it('cancelTask: should fail when it fails to cancel a task', async () => {
    vi.useFakeTimers();
    // Use the more advanced mock for this specific test
    const failingCancellableExecutor = new FailingCancellableMockAgentExecutor();

    handler = new DefaultRequestHandler(
      testAgentCard,
      mockTaskStore,
      failingCancellableExecutor,
      executionEventBusManager
    );

    const streamParams: SendMessageRequest = {
      tenant: '',
      message: createTestMessage('msg-9', 'Start and cancel'),
      configuration: undefined,
      metadata: {}, 
    } as SendMessageRequest;
    const streamGenerator = handler.sendMessageStream(streamParams, serverCallContext);

    const streamEvents: any[] = [];
    (async () => {
      for await (const event of streamGenerator) {
        streamEvents.push(event);
      }
    })();

    // Allow the task to be created and enter the TaskState.TASK_STATE_WORKING state
    await vi.advanceTimersByTimeAsync(25);

    const createdTask = streamEvents.find((e) => 'id' in e) as Task;
    assert.isDefined(createdTask, 'Task creation event should have been received');
    const taskId = createdTask.id;

    let cancelResponse: Task | undefined;
    let thrownError: any;
    try {
      const cancelPromise = handler.cancelTask({ metadata: {}, id: taskId, tenant: '' }, serverCallContext);
      cancelPromise.catch(() => {});
      await vi.runAllTimersAsync();
      try {
        cancelResponse = await cancelPromise;
      } catch (error: any) {
        thrownError = error;
      }
    } finally {
      assert.isDefined(thrownError);
      assert.isUndefined(cancelResponse);
      assert.instanceOf(thrownError, TaskNotCancelableError);
      expect(thrownError.message).to.contain('Task not cancelable');
      expect(failingCancellableExecutor.cancelTaskSpy).toHaveBeenCalledWith(
        taskId,
        expect.anything()
      );
    }
  });

  it('cancelTask: should fail for tasks in a terminal state', async () => {
    const taskId = 'task-terminal';
    const fakeTask: Task = {
      id: taskId,
      contextId: 'ctx-terminal',
      status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
      artifacts: [] as any[],
      metadata: {}, 
      history: [] as any[],
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    try {
      await handler.cancelTask({ metadata: {}, id: taskId, tenant: '' }, serverCallContext);
      assert.fail('Should have thrown a TaskNotCancelableError');
    } catch (error: any) {
      assert.instanceOf(error, TaskNotCancelableError);
      expect(error.message).to.contain('Task not cancelable');
    }
    expect((mockAgentExecutor as MockAgentExecutor).cancelTask).not.toHaveBeenCalled();
  });

  it('should use contextId from incomingMessage if present (contextId assignment logic)', async () => {
    const params: SendMessageRequest = {
      tenant: '',
      configuration: undefined,
      metadata: {}, 
      message: {
        messageId: 'msg-ctx',
        role: Role.ROLE_USER,
        parts: [{ content: { $case: 'text', value: 'Hello' } }],
        contextId: 'incoming-ctx-id',
        taskId: '',
        extensions: [] as any[],
        metadata: {}, referenceTaskIds: []
      },
    } as SendMessageRequest;
    let capturedContextId: string | undefined;
    (mockAgentExecutor.execute as unknown as Mock).mockImplementation(async (ctx, bus) => {
      capturedContextId = ctx.contextId;
      bus.publish({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
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
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
        artifacts: [] as any[],
        history: [] as any[],
      },
      serverCallContext
    );
    const params: SendMessageRequest = {
      tenant: '',
      configuration: undefined,
      metadata: {}, 
      message: {
        messageId: 'msg-ctx2',
        role: Role.ROLE_USER,
        parts: [{ content: { $case: 'text', value: 'Hi' } }],
        taskId,
        contextId: '',
        extensions: [] as any[],
        metadata: {}, referenceTaskIds: []
      },
    } as SendMessageRequest;
    let capturedContextId: string | undefined;
    (mockAgentExecutor.execute as unknown as Mock).mockImplementation(async (ctx, bus) => {
      capturedContextId = ctx.contextId;
      bus.publish({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
      });
      bus.finished();
    });
    await handler.sendMessage(params, serverCallContext);
    expect(capturedContextId).to.equal(taskContextId);
  });

  it('should generate a new contextId if not present in message or task (contextId assignment logic)', async () => {
    const params: SendMessageRequest = {
      tenant: '',
      configuration: undefined,
      metadata: {}, 
      message: {
        messageId: 'msg-ctx3',
        role: Role.ROLE_USER,
        parts: [{ content: { $case: 'text', value: 'Hey' } }],
        taskId: '',
        contextId: '',
        extensions: [] as any[],
        metadata: {}, referenceTaskIds: []
      },
    } as SendMessageRequest;
    let capturedContextId: string | undefined;
    (mockAgentExecutor.execute as unknown as Mock).mockImplementation(async (ctx, bus) => {
      capturedContextId = ctx.contextId;
      bus.publish({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [] as any[],
        history: [] as any[],
        metadata: {}, 
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

    const params: SendMessageRequest = {
      tenant: '',
      configuration: undefined,
      metadata: {}, 
      message: {
        messageId: messageId,
        role: Role.ROLE_USER,
        parts: [{ content: { $case: 'text', value: userMessageText } }],
        contextId: incomingContextId,
        taskId: incomingTaskId,
        extensions: [] as any[],
        metadata: {}, referenceTaskIds: []
      },
    } as SendMessageRequest;

    let capturedRequestContext: RequestContext | undefined;
    (mockAgentExecutor.execute as unknown as Mock).mockImplementation(
      async (ctx: RequestContext, bus: ExecutionEventBus) => {
        capturedRequestContext = ctx;
        bus.publish({
          id: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
          artifacts: [] as any[],
          history: [] as any[],
          metadata: {}, 
        });
        bus.finished();
      }
    );

    const fakeTask: Task = {
      id: params.message!.taskId!,
      contextId: params.message!.contextId!,
      status: {
        state: TaskState.TASK_STATE_SUBMITTED as TaskState,
        message: undefined,
        timestamp: undefined,
      },
      artifacts: [] as any[],
      history: [] as any[],
      metadata: {}, 
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
      extendedAgentCard.capabilities.extensions = [
        {
          uri: 'requested-extension-uri',
          description: 'A requested extension',
          required: false,
          params: undefined,
        },
      ];
      return extendedAgentCard;
    };

    const agentCardWithExtendedSupport = {
      name: 'Test Agent',
      description: 'An agent for testing purposes',
      url: 'http://localhost:8080',
      version: '1.0.0',      capabilities: {
        extensions: [
          {
            uri: 'requested-extension-uri',
            description: 'A requested extension',
            required: false,
            params: undefined,
          },
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
          examples: [] as any[],
          inputModes: ['text/plain'],
          outputModes: ['text/plain'],
          securityRequirements: [] as any[],
        },
      ],      provider: undefined,
      documentationUrl: '',
      securitySchemes: {},
      securityRequirements: [] as any[],      signatures: [] as any[],
    };

    const extendedAgentCard = {
      name: 'Test ExtendedAgentCard Agent',
      description: 'An agent for testing the extended agent card functionality',
      url: 'http://localhost:8080',
      version: '1.0.0',      capabilities: {
        extensions: [
          {
            uri: 'requested-extension-uri',
            description: 'A requested extension',
            required: false,
            params: undefined,
          },
          {
            uri: 'extension-uri-for-authenticated-clients',
            description: 'Extension for authenticated clients',
            required: false,
            params: undefined,
          },
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
          examples: [] as any[],
          inputModes: ['text/plain'],
          outputModes: ['text/plain'],
          securityRequirements: [] as any[],
        },
      ],      provider: undefined,
      documentationUrl: '',
      securitySchemes: {},
      securityRequirements: [] as any[],      signatures: [] as any[],
    };

    it('getAuthenticatedExtendedAgentCard should fail if the agent card does not support extended agent card', async () => {
      let caughtError;
      try {
        await handler.getAuthenticatedExtendedAgentCard();
      } catch (error: any) {
        caughtError = error;
      } finally {
        expect(caughtError).to.be.instanceOf(UnsupportedOperationError);
        expect(caughtError.message).to.contain(
          'Agent does not support authenticated extended card'
        );
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
        expect(caughtError).to.be.instanceOf(AuthenticatedExtendedCardNotConfiguredError);
        expect(caughtError.message).to.contain('Authenticated Extended Card not configured');
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
      assert.deepEqual(agentCard.capabilities.extensions[0], {
        uri: 'requested-extension-uri',
        description: 'A requested extension',
        required: false,
        params: undefined,
      });
      assert.deepEqual(agentCard.name, extendedAgentCard.name);
    });
  });
});

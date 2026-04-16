import { describe, it, beforeEach, afterEach, assert, expect, vi, type Mock } from 'vitest';

import { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';
import {
  TaskNotFoundError,
  PushNotificationNotSupportedError,
  UnsupportedOperationError,
  RequestMalformedError,
  TaskNotCancelableError,
  ExtendedAgentCardNotConfiguredError,
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
  TaskArtifactUpdateEvent,
  DeleteTaskPushNotificationConfigRequest,
  TaskPushNotificationConfig,
  Message,
  Artifact,
  SendMessageConfiguration,
  ListTasksRequest,
  StreamResponse,
} from '../../src/types/pb/a2a.js';
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

  const testAgentCard: AgentCard = {
    name: 'Test Agent',
    description: 'An agent for testing purposes',
    version: '1.0.0',
    provider: undefined,
    documentationUrl: '',
    supportedInterfaces: [
      {
        url: 'http://localhost:8080/a2a/v1',
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
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
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A skill for testing',
        tags: ['test'],
        examples: [],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
        securityRequirements: [],
      },
    ],
    signatures: [],
  };

  const serverCallContext = new ServerCallContext();

  // Before each test, reset the components to a clean state
  beforeEach(() => {
    // Default mock for most tests
    mockTaskStore = new InMemoryTaskStore();
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
    parts: [
      {
        content: { $case: 'text', value: text },
        mediaType: 'text/plain',
        filename: '',
        metadata: undefined,
      },
    ],
    taskId: '',
    contextId: '',
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  });

  it('sendMessage: should return a simple message response', async () => {
    const params: SendMessageRequest = {
      message: createTestMessage('msg-1', 'Hello'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const agentResponse: Message = {
      messageId: 'agent-msg-1',
      role: Role.ROLE_AGENT,
      parts: [
        {
          content: { $case: 'text', value: 'Hi there!' },
          mediaType: 'text/plain',
          filename: '',
          metadata: undefined,
        },
      ],
      taskId: 'task-msg-1',
      contextId: '',
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    };

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      // Publish task creation event so ResultManager creates the task
      bus.publish({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
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
      message: createTestMessage('msg-2', 'Do a task'),
      tenant: '',
      configuration: {
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        returnImmediately: false,
      },
      metadata: {},
    };

    const taskId = 'task-123';
    const contextId = 'ctx-abc';
    const testArtifact: Artifact = {
      artifactId: 'artifact-1',
      name: 'Test Document',
      description: 'A test artifact.',
      parts: [
        {
          content: { $case: 'text', value: 'This is the content of the artifact.' },
          mediaType: 'text/plain',
          filename: '',
          metadata: undefined,
        },
      ],
      metadata: {},
      extensions: [],
    };

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      });
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
      });
      bus.publish({
        taskId,
        contextId,
        artifact: testArtifact,
        append: false,
        lastChunk: true,
        metadata: {},
      });
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: undefined,
          message: {
            role: Role.ROLE_AGENT,
            parts: [
              {
                content: { $case: 'text', value: 'Done!' },
                mediaType: 'text/plain',
                filename: '',
                metadata: undefined,
              },
            ],
            messageId: 'agent-msg-2',
            taskId,
            contextId,
            extensions: [],
            metadata: {},
            referenceTaskIds: [],
          },
        },
        metadata: {},
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

    // Test blocking case
    const blockingParams: SendMessageRequest = {
      message: createTestMessage('msg-fail-block', 'Test failure blocking'),
      tenant: '',
      configuration: {
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        returnImmediately: false,
      },
      metadata: {},
    };

    const blockingResult = await handler.sendMessage(blockingParams, serverCallContext);
    const blockingTask = blockingResult as Task;

    assert.equal(
      blockingTask.status.state,
      TaskState.TASK_STATE_FAILED,
      'Task status should be failed'
    );
    assert.include(
      (blockingTask.status.message?.parts[0].content as { $case: 'text'; value: string }).value,
      errorMessage,
      'Error message should be in the status'
    );
  });

  it('sendMessage: (non-blocking) should return first task event immediately and process full task in background', async () => {
    vi.useFakeTimers();
    const saveSpy = vi.spyOn(mockTaskStore, 'save');

    const params: SendMessageRequest = {
      message: createTestMessage('msg-nonblock', 'Do a long task'),
      tenant: '',
      configuration: {
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        returnImmediately: true,
      },
      metadata: {},
    };

    const taskId = 'task-nonblock-123';
    const contextId = 'ctx-nonblock-abc';

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      // First event is the task creation, which should be returned immediately
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      });

      // Simulate work before publishing more events
      await vi.advanceTimersByTimeAsync(500);

      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
        metadata: {},
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
      message: createTestMessage('msg-nonblock', 'Do a long task'),
      tenant: '',
      configuration: {
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        returnImmediately: true,
      },
      metadata: {},
    };

    const taskId = 'task-nonblock-123';
    const contextId = 'ctx-nonblock-abc';
    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      // First event is the task creation, which should be returned immediately
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      });

      // Simulate work before publishing more events
      await vi.advanceTimersByTimeAsync(500);

      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
        metadata: {},
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
      (finalTaskSaved!.status.message!.parts[0].content as { $case: 'text'; value: string }).value,
      `Event processing loop failed: ${errorMessage}`
    );
  });

  it('sendMessage: should handle agent execution failure for non-blocking calls', async () => {
    const errorMessage = 'Agent failed!';
    (mockAgentExecutor as MockAgentExecutor).execute.mockRejectedValue(new Error(errorMessage));

    // Test non-blocking case
    const nonBlockingParams: SendMessageRequest = {
      message: createTestMessage('msg-fail-nonblock', 'Test failure non-blocking'),
      tenant: '',
      configuration: {
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        returnImmediately: true,
      },
      metadata: {},
    };

    const nonBlockingResult = await handler.sendMessage(nonBlockingParams, serverCallContext);
    const nonBlockingTask = nonBlockingResult as Task;

    assert.equal(
      nonBlockingTask.status.state,
      TaskState.TASK_STATE_FAILED,
      'Task status should be failed'
    );
    assert.include(
      (nonBlockingTask.status.message?.parts[0].content as { $case: 'text'; value: string }).value,
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
      message: firstMessage,
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    let taskId: string;

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      taskId = ctx.taskId;

      // Publish task creation
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      });

      // Publish working status
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
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
            parts: [
              {
                content: { $case: 'text', value: 'Response to message 1' },
                mediaType: 'text/plain',
                filename: '',
                metadata: undefined,
              },
            ],
            taskId,
            contextId,
            extensions: [],
            metadata: {},
            referenceTaskIds: [],
          },
        },
        metadata: {},
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
      message: secondMessage,
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      // Publish a status update with working state
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
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
            parts: [
              {
                content: { $case: 'text', value: 'Response to message 2' },
                mediaType: 'text/plain',
                filename: '',
                metadata: undefined,
              },
            ],
            taskId,
            contextId,
            extensions: [],
            metadata: {},
            referenceTaskIds: [],
          },
        },
        metadata: {},
      });

      // Publish an artifact update
      bus.publish({
        taskId,
        contextId,
        artifact: {
          artifactId: 'artifact-1',
          name: 'Test Document',
          description: 'A test artifact.',
          parts: [
            {
              content: { $case: 'text', value: 'This is the content of the artifact.' },
              mediaType: 'text/plain',
              filename: '',
              metadata: undefined,
            },
          ],
          metadata: {},
          extensions: [],
        },
        append: false,
        lastChunk: true,
        metadata: {},
      });

      // Mark as completed
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: undefined,
          message: undefined,
        },
        metadata: {},
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
    assert.equal(
      (secondTask.history![0].parts[0].content as { $case: 'text'; value: string }).value,
      'Message 1'
    );
    assert.equal(
      secondTask.history![1].messageId,
      'agent-msg-1',
      'Second message should be first agent message'
    );
    assert.equal(
      (secondTask.history![1].parts[0].content as { $case: 'text'; value: string }).value,
      'Response to message 1'
    );
    assert.equal(
      secondTask.history![2].messageId,
      'msg-2',
      'Third message should be second user message'
    );
    assert.equal(
      (secondTask.history![2].parts[0].content as { $case: 'text'; value: string }).value,
      'Message 2'
    );
    assert.equal(
      secondTask.history![3].messageId,
      'agent-msg-2',
      'Fourth message should be second agent message'
    );
    assert.equal(
      (secondTask.history![3].parts[0].content as { $case: 'text'; value: string }).value,
      'Response to message 2'
    );
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
      (secondTask.artifacts![0].parts[0].content as { $case: 'text'; value: string }).value,
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
      message: firstMessage,
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    let taskId: string;

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      taskId = ctx.taskId;

      // Publish task creation
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      });

      // Publish working status
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
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
            parts: [
              {
                content: { $case: 'text', value: 'Response to message 1' },
                mediaType: 'text/plain',
                filename: '',
                metadata: undefined,
              },
            ],
            taskId,
            contextId,
            extensions: [],
            metadata: {},
            referenceTaskIds: [],
          },
        },
        metadata: {},
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
      message: secondMessage,
      tenant: '',
      configuration: {
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        returnImmediately: true,
      },
      metadata: {},
    };

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      // Publish a status update with working state
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
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
            parts: [
              {
                content: { $case: 'text', value: 'Response to message 2' },
                mediaType: 'text/plain',
                filename: '',
                metadata: undefined,
              },
            ],
            taskId,
            contextId,
            extensions: [],
            metadata: {},
            referenceTaskIds: [],
          },
        },
        metadata: {},
      });

      // Publish an artifact update
      bus.publish({
        taskId,
        contextId,
        artifact: {
          artifactId: 'artifact-1',
          name: 'Test Document',
          description: 'A test artifact.',
          parts: [
            {
              content: { $case: 'text', value: 'This is the content of the artifact.' },
              mediaType: 'text/plain',
              filename: '',
              metadata: undefined,
            },
          ],
          metadata: {},
          extensions: [],
        },
        append: false,
        lastChunk: true,
        metadata: {},
      });

      // Mark as completed
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: undefined,
          message: undefined,
        },
        metadata: {},
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
    assert.equal(
      (finalTask.history![0].parts[0].content as { $case: 'text'; value: string }).value,
      'Message 1'
    );
    assert.equal(
      finalTask.history![1].messageId,
      'agent-msg-1',
      'Second message should be first agent message'
    );
    assert.equal(
      (finalTask.history![1].parts[0].content as { $case: 'text'; value: string }).value,
      'Response to message 1'
    );
    assert.equal(
      finalTask.history![2].messageId,
      'msg-2',
      'Third message should be second user message'
    );
    assert.equal(
      (finalTask.history![2].parts[0].content as { $case: 'text'; value: string }).value,
      'Message 2'
    );
    assert.equal(
      finalTask.history![3].messageId,
      'agent-msg-2',
      'Fourth message should be second agent message'
    );
    assert.equal(
      (finalTask.history![3].parts[0].content as { $case: 'text'; value: string }).value,
      'Response to message 2'
    );
    assert.equal(finalTask.artifacts![0].artifactId, 'artifact-1', 'Artifact should be the same');
    assert.equal(finalTask.artifacts![0].name, 'Test Document', 'Artifact name should be the same');
    assert.equal(
      finalTask.artifacts![0].description,
      'A test artifact.',
      'Artifact description should be the same'
    );
    assert.equal(
      (finalTask.artifacts![0].parts[0].content as { $case: 'text'; value: string }).value,
      'This is the content of the artifact.',
      'Artifact content should be the same'
    );
  });

  it('sendMessageStream: should stream submitted, working, and completed events', async () => {
    const params: SendMessageRequest = {
      message: createTestMessage('msg-3', 'Stream a task'),
    } as SendMessageRequest;
    const taskId = 'task-stream-1';
    const contextId = 'ctx-stream-1';

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      });
      await new Promise((res) => setTimeout(res, 10));
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
      });
      await new Promise((res) => setTimeout(res, 10));
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
        metadata: {},
      });
      bus.finished();
    });

    const eventGenerator = handler.sendMessageStream(params, serverCallContext);
    const events: StreamResponse[] = [];
    for await (const event of eventGenerator) {
      events.push(event);
    }

    assert.lengthOf(events, 3, 'Stream should yield 3 events');
    assert.equal(
      (events[0].payload as { $case: 'task'; value: Task }).value.status?.state,
      TaskState.TASK_STATE_SUBMITTED
    );
    assert.equal(
      (events[1].payload as { $case: 'statusUpdate'; value: TaskStatusUpdateEvent }).value.status
        ?.state,
      TaskState.TASK_STATE_WORKING
    );
    assert.equal(
      (events[2].payload as { $case: 'statusUpdate'; value: TaskStatusUpdateEvent }).value.status
        ?.state,
      TaskState.TASK_STATE_COMPLETED
    );
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
        artifacts: [],
        history: [],
        metadata: {},
      };
      await mockTaskStore.save(fakeTask, serverCallContext);

      const params: SendMessageRequest = {
        message: { ...createTestMessage('msg-1', 'test'), taskId: taskId },
      } as SendMessageRequest;

      try {
        await handler.sendMessage(params, serverCallContext);
        assert.fail(`Should have thrown for state: ${state}`);
      } catch (error: any) {
        expect(error).to.be.instanceOf(UnsupportedOperationError);
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
      artifacts: [],
      metadata: {},
      history: [],
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    const params: SendMessageRequest = {
      message: { ...createTestMessage('msg-1', 'test'), taskId: taskId },
    } as SendMessageRequest;

    const generator = handler.sendMessageStream(params, serverCallContext);

    try {
      await generator.next();
      assert.fail('sendMessageStream should have thrown an error');
    } catch (error: any) {
      expect(error).to.be.instanceOf(UnsupportedOperationError);
      expect(error.message).toContain(`Task ${taskId} is in a terminal state`);
    }
  });

  it('sendMessageStream: should stop at input-required state', async () => {
    const params: SendMessageRequest = {
      message: createTestMessage('msg-4', 'I need input'),
    } as SendMessageRequest;
    const taskId = 'task-input';
    const contextId = 'ctx-input';

    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      bus.publish({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      });
      bus.publish({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_INPUT_REQUIRED,
          message: undefined,
          timestamp: undefined,
        },
        metadata: {},
      });
      bus.finished();
    });

    const eventGenerator = handler.sendMessageStream(params, serverCallContext);
    const events: StreamResponse[] = [];
    for await (const event of eventGenerator) {
      events.push(event);
    }

    assert.lengthOf(events, 2);
    const lastEvent = events[1];
    assert.equal(
      (lastEvent.payload as { $case: 'statusUpdate'; value: TaskStatusUpdateEvent }).value.status
        ?.state,
      TaskState.TASK_STATE_INPUT_REQUIRED
    );
  });

  it('resubscribe: should allow multiple clients to receive events for the same task', async () => {
    const saveSpy = vi.spyOn(mockTaskStore, 'save');
    vi.useFakeTimers();
    const params: SendMessageRequest = {
      message: createTestMessage('msg-5', 'Long running task'),
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
        artifacts: [],
        history: [],
        metadata: {},
      });
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
      });
      await vi.advanceTimersByTimeAsync(100);
      bus.publish({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
        metadata: {},
      });
      bus.finished();
    });

    const stream1_generator = handler.sendMessageStream(params, serverCallContext);
    const stream1_iterator = stream1_generator[Symbol.asyncIterator]();

    const firstEventResult = await stream1_iterator.next();
    assert.isFalse(firstEventResult.done, 'Generator should not be done yet');
    const firstEvent = firstEventResult.value as StreamResponse;
    assert.equal(
      (firstEvent.payload as { $case: 'task'; value: Task }).value.id,
      taskId,
      'Should get task event first'
    );

    const secondEventResult = await stream1_iterator.next();
    assert.isFalse(secondEventResult.done, 'Generator should not be done yet');
    const secondEvent = secondEventResult.value as StreamResponse;
    assert.equal(
      (secondEvent.payload as { $case: 'statusUpdate'; value: TaskStatusUpdateEvent }).value.taskId,
      taskId,
      'Should get the task status update event second'
    );

    const stream2_generator = handler.resubscribe({ id: taskId, tenant: '' }, serverCallContext);

    const results1: StreamResponse[] = [firstEvent, secondEvent];
    const results2: StreamResponse[] = [];

    const collect = async (iterator: AsyncGenerator<StreamResponse>, results: StreamResponse[]) => {
      for await (const res of iterator) {
        results.push(res);
      }
    };

    const p1 = collect(stream1_iterator, results1);
    const p2 = collect(stream2_generator, results2);

    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    assert.equal(
      (results1[0].payload as { $case: 'task'; value: Task }).value.status?.state,
      TaskState.TASK_STATE_SUBMITTED
    );
    assert.equal(
      (results1[1].payload as { $case: 'statusUpdate'; value: TaskStatusUpdateEvent }).value.status
        ?.state,
      TaskState.TASK_STATE_WORKING
    );
    assert.equal(
      (results1[2].payload as { $case: 'statusUpdate'; value: TaskStatusUpdateEvent }).value.status
        ?.state,
      TaskState.TASK_STATE_COMPLETED
    );

    // First event of resubscribe is always a task.
    assert.equal(
      (results2[0].payload as { $case: 'task'; value: Task }).value.status?.state,
      TaskState.TASK_STATE_WORKING
    );
    assert.equal(
      (results2[1].payload as { $case: 'statusUpdate'; value: TaskStatusUpdateEvent }).value.status
        ?.state,
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
      artifacts: [],
      metadata: {},
      history: [],
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    const result = await handler.getTask(
      { id: fakeTask.id, tenant: '', historyLength: 0 },
      serverCallContext
    );
    assert.deepEqual(result, fakeTask);
  });

  it('listTasks: should return tasks from the store', async () => {
    const fakeTask1: Task = {
      id: 'task-list-1',
      contextId: 'ctx-list',
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
      artifacts: [],
      metadata: {},
      history: [],
    };
    const fakeTask2: Task = { ...fakeTask1, id: 'task-list-2' };

    await mockTaskStore.save(fakeTask1, serverCallContext);
    await mockTaskStore.save(fakeTask2, serverCallContext);

    const params: ListTasksRequest = {
      tenant: '',
      contextId: 'ctx-list',
      status: TaskState.TASK_STATE_WORKING,
      pageSize: 10,
      pageToken: '',
      historyLength: 0,
      statusTimestampAfter: undefined,
      includeArtifacts: false,
    };

    const result = await handler.listTasks(params, serverCallContext);
    assert.lengthOf(result.tasks, 2);
    // Tasks are listed in reverse order of creation
    assert.equal(result.tasks[0].id, fakeTask2.id);
    assert.equal(result.tasks[1].id, fakeTask1.id);
  });

  it('listTasks: should throw RequestMalformedError if pageSize is < 1', async () => {
    const params: ListTasksRequest = {
      tenant: '',
      contextId: '',
      status: TaskState.TASK_STATE_WORKING,
      pageSize: 0,
      pageToken: '',
      historyLength: 0,
      statusTimestampAfter: undefined,
      includeArtifacts: false,
    };

    try {
      await handler.listTasks(params, serverCallContext);
      assert.fail('Should have thrown an error for pageSize < 1');
    } catch (error: any) {
      expect(error).to.be.instanceOf(RequestMalformedError);
      expect(error.message).to.contain('pageSize must be between 1 and 100');
    }
  });

  it('listTasks: should throw RequestMalformedError if pageSize is > 100', async () => {
    const params: ListTasksRequest = {
      tenant: '',
      contextId: '',
      status: TaskState.TASK_STATE_WORKING,
      pageSize: 101,
      pageToken: '',
      historyLength: 0,
      statusTimestampAfter: undefined,
      includeArtifacts: false,
    };

    try {
      await handler.listTasks(params, serverCallContext);
      assert.fail('Should have thrown an error for pageSize > 100');
    } catch (error: any) {
      expect(error).to.be.instanceOf(RequestMalformedError);
      expect(error.message).to.contain('pageSize must be between 1 and 100');
    }
  });

  it('create/getTaskPushNotificationConfig: should save and retrieve config', async () => {
    const taskId = 'task-push-config';
    const fakeTask: Task = {
      id: taskId,
      contextId: 'ctx-push',
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
      artifacts: [],
      metadata: {},
      history: [],
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    const pushConfig: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'config-1',
      url: 'https://example.com/notify',
      token: 'secret-token',
      authentication: undefined,
    };

    const createParams: TaskPushNotificationConfig = {
      tenant: '',
      id: pushConfig.id,
      taskId: taskId,
      url: pushConfig.url,
      token: pushConfig.token,
      authentication: pushConfig.authentication,
    };
    const createResponse = await handler.createTaskPushNotificationConfig(
      createParams,
      serverCallContext
    );
    assert.deepEqual(createResponse, createParams, 'Create response should return the config');

    const getParams: GetTaskPushNotificationConfigRequest = {
      tenant: '',
      taskId: taskId,
      id: 'config-1',
    };
    const getResponse = await handler.getTaskPushNotificationConfig(getParams, serverCallContext);
    assert.deepEqual(getResponse, createParams, 'Get response should return the saved config');
  });

  it('create/getTaskPushNotificationConfig: should save and retrieve config by task ID for backward compatibility', async () => {
    const taskId = 'task-push-compat';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-compat',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
        artifacts: [],
        history: [],
      },
      serverCallContext
    );

    // Config ID defaults to task ID
    const pushConfig: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      url: 'https://example.com/notify-compat',
      id: taskId,
      token: 'compat-token',
      authentication: undefined,
    };
    await handler.createTaskPushNotificationConfig(
      {
        tenant: '',
        id: pushConfig.id || taskId, // if id is missing or equals taskId in test
        taskId: taskId,
        url: pushConfig.url,
        token: pushConfig.token,
        authentication: pushConfig.authentication,
      },
      serverCallContext
    );

    const getResponse = await handler.getTaskPushNotificationConfig(
      {
        tenant: '',
        taskId: taskId,
        id: taskId,
      },
      serverCallContext
    );
    expect(getResponse.id).to.equal(taskId);
    expect(getResponse.url).to.equal(pushConfig.url);
  });

  it('createTaskPushNotificationConfig: should overwrite an existing config with the same ID', async () => {
    const taskId = 'task-overwrite';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-overwrite',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
        artifacts: [],
        history: [],
      },
      serverCallContext
    );
    const initialConfig: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'config-same',
      url: 'https://initial.url',
      token: 'token-same',
      authentication: undefined,
    };
    await handler.createTaskPushNotificationConfig(
      {
        tenant: '',
        taskId: taskId,
        id: initialConfig.id,
        url: initialConfig.url,
        token: initialConfig.token,
        authentication: initialConfig.authentication,
      },
      serverCallContext
    );

    const newConfig: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'config-same',
      url: 'https://new.url',
      token: 'token-new',
      authentication: undefined,
    };
    await handler.createTaskPushNotificationConfig(
      {
        tenant: '',
        taskId: taskId,
        id: newConfig.id,
        url: newConfig.url,
        token: newConfig.token,
        authentication: newConfig.authentication,
      },
      serverCallContext
    );

    const result = await handler.listTaskPushNotificationConfigs(
      {
        tenant: '',
        taskId: taskId,
        pageSize: 0,
        pageToken: '',
      },
      serverCallContext
    );
    expect(result.configs).to.have.lengthOf(1);
    expect(result.configs[0].url).to.equal('https://new.url');
    expect(result.nextPageToken).to.equal('');
  });

  it('listTaskPushNotificationConfigs: should return all configs for a task', async () => {
    const taskId = 'task-list-configs';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-list',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
        artifacts: [],
        history: [],
      },
      serverCallContext
    );
    const config1: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'cfg1',
      url: 'https://url1.com',
      token: 'token-1',
      authentication: undefined,
    };
    const config2: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'cfg2',
      url: 'https://url2.com',
      token: 'token-2',
      authentication: undefined,
    };
    await handler.createTaskPushNotificationConfig(
      {
        tenant: '',
        taskId: taskId,
        id: config1.id,
        url: config1.url,
        token: config1.token,
        authentication: config1.authentication,
      },
      serverCallContext
    );
    await handler.createTaskPushNotificationConfig(
      {
        tenant: '',
        taskId: taskId,
        id: config2.id,
        url: config2.url,
        token: config2.token,
        authentication: config2.authentication,
      },
      serverCallContext
    );

    const listParams: ListTaskPushNotificationConfigsRequest = {
      tenant: '',
      taskId: taskId,
      pageSize: 0,
      pageToken: '',
    };
    const listResponse = (
      await handler.listTaskPushNotificationConfigs(listParams, serverCallContext)
    ).configs;

    expect(listResponse).to.be.an('array').with.lengthOf(2);
    assert.deepInclude(listResponse, {
      tenant: '',
      taskId: taskId,
      id: config1.id,
      url: config1.url,
      token: config1.token,
      authentication: config1.authentication,
    });
    assert.deepInclude(listResponse, {
      tenant: '',
      taskId: taskId,
      id: config2.id,
      url: config2.url,
      token: config2.token,
      authentication: config2.authentication,
    });
  });

  it('deleteTaskPushNotificationConfig: should remove a specific config', async () => {
    const taskId = 'task-delete-config';
    await mockTaskStore.save(
      {
        id: taskId,
        contextId: 'ctx-delete',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
        artifacts: [],
        history: [],
      },
      serverCallContext
    );
    const config1: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'cfg-del-1',
      url: 'https://url1.com',
      token: 'token-1',
      authentication: undefined,
    };
    const config2: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'cfg-del-2',
      url: 'https://url2.com',
      token: 'token-2',
      authentication: undefined,
    };
    await handler.createTaskPushNotificationConfig(
      {
        tenant: '',
        id: config1.id,
        taskId: taskId,
        url: config1.url,
        token: config1.token,
        authentication: config1.authentication,
      },
      serverCallContext
    );
    await handler.createTaskPushNotificationConfig(
      {
        tenant: '',
        id: config2.id,
        taskId: taskId,
        url: config2.url,
        token: config2.token,
        authentication: config2.authentication,
      },
      serverCallContext
    );

    const deleteParams: DeleteTaskPushNotificationConfigRequest = {
      id: 'cfg-del-1',
      taskId: taskId,
      tenant: '',
    };
    await handler.deleteTaskPushNotificationConfig(deleteParams, serverCallContext);

    const remainingConfigs = (
      await handler.listTaskPushNotificationConfigs(
        {
          taskId: taskId,
          tenant: '',
          pageSize: 0,
          pageToken: '',
        },
        serverCallContext
      )
    ).configs;
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
        artifacts: [],
        history: [],
      },
      serverCallContext
    );
    const config: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'cfg-last',
      url: 'https://last.com',
      token: 'token-last',
      authentication: undefined,
    };
    await handler.createTaskPushNotificationConfig(
      {
        tenant: '',
        id: config.id,
        taskId: taskId,
        url: config.url,
        token: config.token,
        authentication: config.authentication,
      },
      serverCallContext
    );

    await handler.deleteTaskPushNotificationConfig(
      {
        id: 'cfg-last',
        taskId: taskId,
        tenant: '',
      },
      serverCallContext
    );

    const result = await handler.listTaskPushNotificationConfigs(
      {
        taskId: taskId,
        tenant: '',
        pageSize: 0,
        pageToken: '',
      },
      serverCallContext
    );
    expect(result.configs).to.be.an('array').with.lengthOf(0);
    expect(result.nextPageToken).to.equal('');
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
    const pushNotification: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      url: 'https://push-1.com',
      id: 'push-1',
      token: 'token-1',
      authentication: undefined,
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
        taskPushNotificationConfig: { ...pushNotification, taskId: '', tenant: '' },
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
      artifacts: [],
      metadata: {},
      history: [params.message as Message],
    };

    // Verify push notifications were sent with complete task objects
    expect((mockPushNotificationSender as MockPushNotificationSender).send).toHaveBeenCalledTimes(
      3
    );

    // Verify first call (submitted state)
    const firstCallResponse = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[0][0] as StreamResponse;
    const expectedFirstResponse: StreamResponse = {
      payload: {
        $case: 'task',
        value: {
          ...expectedTask,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
        },
      },
    };
    assert.deepEqual(firstCallResponse, expectedFirstResponse);

    // Verify second call (working state)
    const secondCallResponse = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[1][0] as StreamResponse;
    const expectedSecondResponse: StreamResponse = {
      payload: {
        $case: 'statusUpdate',
        value: {
          taskId: taskId,
          contextId: contextId,
          status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
          metadata: {},
        },
      },
    };
    assert.deepEqual(secondCallResponse, expectedSecondResponse);

    // Verify third call (completed state)
    const thirdCallResponse = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[2][0] as StreamResponse;
    const expectedThirdResponse: StreamResponse = {
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
    };
    assert.deepEqual(thirdCallResponse, expectedThirdResponse);
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
    const pushNotification: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      url: 'https://push-stream-1.com',
      id: 'push-stream-1',
      token: 'token-stream-1',
      authentication: undefined,
    };

    const contextId = 'ctx-push-stream-1';

    const params: SendMessageRequest = {
      tenant: '',
      metadata: {},
      message: {
        ...createTestMessage('msg-push-stream-1', 'Work on task with push notification via stream'),
        contextId: contextId,
      },
      configuration: {
        taskPushNotificationConfig: { ...pushNotification, taskId: '', tenant: '' },
      } as SendMessageConfiguration,
    };

    let taskId: string;
    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      taskId = ctx.taskId;
      fakeTaskExecute(ctx, bus);
    });

    const eventGenerator = handler.sendMessageStream(params, serverCallContext);
    const events: StreamResponse[] = [];
    for await (const event of eventGenerator) {
      events.push(event);
    }

    // Verify stream events
    assert.lengthOf(events, 3, 'Stream should yield 3 events');
    assert.equal(
      (events[0].payload as { $case: 'task'; value: Task }).value.status?.state,
      TaskState.TASK_STATE_SUBMITTED
    );
    assert.equal(
      (events[1].payload as { $case: 'statusUpdate'; value: TaskStatusUpdateEvent }).value.status
        ?.state,
      TaskState.TASK_STATE_WORKING
    );
    assert.equal(
      (events[2].payload as { $case: 'statusUpdate'; value: TaskStatusUpdateEvent }).value.status
        ?.state,
      TaskState.TASK_STATE_COMPLETED
    );

    // Verify push notifications were sent with complete task objects
    expect((mockPushNotificationSender as MockPushNotificationSender).send).toHaveBeenCalledTimes(
      3
    );

    const expectedTask: Task = {
      id: taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
      artifacts: [],
      metadata: {},
      history: [params.message as Message],
    };
    // Verify first call (submitted state)
    const firstCallResponse = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[0][0] as StreamResponse;
    const expectedFirstResponse: StreamResponse = {
      payload: {
        $case: 'task',
        value: {
          ...expectedTask,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
        },
      },
    };
    assert.deepEqual(firstCallResponse, expectedFirstResponse);

    // Verify second call (working state)
    const secondCallResponse = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[1][0] as StreamResponse;
    const expectedSecondResponse: StreamResponse = {
      payload: {
        $case: 'statusUpdate',
        value: {
          taskId: taskId,
          contextId: contextId,
          status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
          metadata: {},
        },
      },
    };
    assert.deepEqual(secondCallResponse, expectedSecondResponse);

    // Verify third call (completed state)
    const thirdCallResponse = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[2][0] as StreamResponse;
    const expectedThirdResponse: StreamResponse = {
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
    };
    assert.deepEqual(thirdCallResponse, expectedThirdResponse);
  });

  it('should send push notification when message event is received', async () => {
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
    const pushNotification: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      url: 'https://push-1.com',
      id: 'push-1',
      token: 'token-1',
      authentication: undefined,
    };
    const contextId = 'ctx-push-message';

    const params: SendMessageRequest = {
      tenant: '',
      metadata: {},
      message: {
        ...createTestMessage('msg-push-message', 'Test message push'),
        contextId: contextId,
      },
      configuration: {
        taskPushNotificationConfig: { ...pushNotification, taskId: '', tenant: '' },
      } as SendMessageConfiguration,
    };

    let taskId: string;
    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      taskId = ctx.taskId;
      bus.publish({
        messageId: 'msg-reply-1',
        taskId: taskId,
        contextId: contextId,
        parts: [],
        metadata: {},
        extensions: [],
        referenceTaskIds: [],
      } as Message);
      bus.finished();
    });

    await handler.sendMessage(params, serverCallContext);

    expect((mockPushNotificationSender as MockPushNotificationSender).send).toHaveBeenCalled();
    const callResponse = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[0][0] as StreamResponse;
    expect(callResponse.payload.$case).toBe('message');
    expect((callResponse.payload as { value: Message }).value.messageId).toBe('msg-reply-1');
  });

  it('should send push notification when statusUpdate event is received', async () => {
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
    const pushNotification: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      url: 'https://push-1.com',
      id: 'push-1',
      token: 'token-1',
      authentication: undefined,
    };
    const contextId = 'ctx-push-status';

    const params: SendMessageRequest = {
      tenant: '',
      metadata: {},
      message: {
        ...createTestMessage('msg-push-status', 'Test status push'),
        contextId: contextId,
      },
      configuration: {
        taskPushNotificationConfig: { ...pushNotification, taskId: '', tenant: '' },
      } as SendMessageConfiguration,
    };

    let taskId: string;
    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      taskId = ctx.taskId;
      bus.publish({
        id: taskId,
        contextId: contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      } as Task);
      bus.publish({
        taskId: taskId,
        contextId: contextId,
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: new Date().toISOString() },
        metadata: {},
      } as TaskStatusUpdateEvent);
      bus.publish({
        taskId: taskId,
        contextId: contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: new Date().toISOString() },
        metadata: {},
      } as TaskStatusUpdateEvent);
      bus.finished();
    });

    await handler.sendMessage(params, serverCallContext);

    expect((mockPushNotificationSender as MockPushNotificationSender).send).toHaveBeenCalled();
    const callResponse = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[1][0] as StreamResponse;
    expect(callResponse.payload.$case).toBe('statusUpdate');
  });

  it('should send push notification when artifactUpdate event is received', async () => {
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
    const pushNotification: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      url: 'https://push-1.com',
      id: 'push-1',
      token: 'token-1',
      authentication: undefined,
    };
    const contextId = 'ctx-push-artifact';

    const params: SendMessageRequest = {
      tenant: '',
      metadata: {},
      message: {
        ...createTestMessage('msg-push-artifact', 'Test artifact push'),
        contextId: contextId,
      },
      configuration: {
        taskPushNotificationConfig: { ...pushNotification, taskId: '', tenant: '' },
      } as SendMessageConfiguration,
    };

    let taskId: string;
    (mockAgentExecutor as MockAgentExecutor).execute.mockImplementation(async (ctx, bus) => {
      taskId = ctx.taskId;
      bus.publish({
        id: taskId,
        contextId: contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      } as Task);
      bus.publish({
        taskId: taskId,
        contextId: contextId,
        artifact: {
          name: 'art-1',
          mimeType: 'text/plain',
          content: Buffer.from('hello').toString('base64'),
        },
        metadata: {},
        append: false,
        lastChunk: true,
      } as unknown as TaskArtifactUpdateEvent);
      bus.publish({
        taskId: taskId,
        contextId: contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: new Date().toISOString() },
        metadata: {},
      } as TaskStatusUpdateEvent);
      bus.finished();
    });

    await handler.sendMessage(params, serverCallContext);

    expect((mockPushNotificationSender as MockPushNotificationSender).send).toHaveBeenCalled();
    const callResponse = (mockPushNotificationSender as MockPushNotificationSender).send.mock
      .calls[1][0] as StreamResponse;
    expect(callResponse.payload.$case).toBe('artifactUpdate');
  });

  it('Push Notification methods should throw error if task does not exist', async () => {
    const nonExistentTaskId = 'task-non-existent';
    const config: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'cfg-x',
      url: 'https://x.com',
      token: 'token-x',
      authentication: undefined,
    };

    const methodsToTest = [
      {
        name: 'createTaskPushNotificationConfig',
        params: {
          name: `tasks/${nonExistentTaskId}/pushNotificationConfigs/${config.id}`,
          pushNotificationConfig: config,
        },
      },
      {
        name: 'getTaskPushNotificationConfig',
        params: { name: `tasks/${nonExistentTaskId}/pushNotificationConfigs/cfg-x` },
      },
      {
        name: 'listTaskPushNotificationConfigs',
        params: { parent: `tasks/${nonExistentTaskId}`, pageSize: 0, pageToken: '' },
      },
      {
        name: 'deleteTaskPushNotificationConfig',
        params: { name: `tasks/${nonExistentTaskId}/pushNotificationConfigs/cfg-x` },
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
        artifacts: [],
        history: [],
      },
      serverCallContext
    );
    const config: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'cfg-u',
      url: 'https://u.com',
      token: 'token-u',
      authentication: undefined,
    };

    const methodsToTest = [
      {
        name: 'createTaskPushNotificationConfig',
        params: {
          parent: `tasks/${taskId}`,
          pushNotification: config,
          pushNotificationConfigId: config.id,
        },
      },
      {
        name: 'getTaskPushNotificationConfig',
        params: { name: `tasks/${taskId}/pushNotificationConfigs/cfg-u` },
      },
      {
        name: 'listTaskPushNotificationConfigs',
        params: { parent: `tasks/${taskId}`, pageSize: 0, pageToken: '' },
      },
      {
        name: 'deleteTaskPushNotificationConfig',
        params: { name: `tasks/${taskId}/pushNotificationConfigs/cfg-u` },
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
      message: createTestMessage('msg-9', 'Start and cancel'),
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

    const createdTaskEvent = streamEvents.find((e) => e.payload?.$case === 'task');
    assert.isDefined(createdTaskEvent, 'Task creation event should have been received');
    const taskId = createdTaskEvent.payload.value.id;

    // Now, issue the cancel request
    const cancelPromise = handler.cancelTask(
      { id: taskId, tenant: '', metadata: {} },
      serverCallContext
    );

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
      message: createTestMessage('msg-9', 'Start and cancel'),
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

    const createdTaskEvent = streamEvents.find((e) => e.payload?.$case === 'task');
    assert.isDefined(createdTaskEvent, 'Task creation event should have been received');
    const taskId = createdTaskEvent.payload.value.id;

    let cancelResponse: Task | undefined;
    let thrownError: any;
    try {
      const cancelPromise = handler.cancelTask(
        { id: taskId, tenant: '', metadata: {} },
        serverCallContext
      );
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
      artifacts: [],
      metadata: {},
      history: [],
    };
    await mockTaskStore.save(fakeTask, serverCallContext);

    try {
      await handler.cancelTask({ id: taskId, tenant: '', metadata: {} }, serverCallContext);
      assert.fail('Should have thrown a TaskNotCancelableError');
    } catch (error: any) {
      assert.instanceOf(error, TaskNotCancelableError);
      expect(error.message).to.contain('Task not cancelable');
    }
    expect((mockAgentExecutor as MockAgentExecutor).cancelTask).not.toHaveBeenCalled();
  });

  it('should use contextId from incomingMessage if present (contextId assignment logic)', async () => {
    const params: SendMessageRequest = {
      message: {
        messageId: 'msg-ctx',
        role: Role.ROLE_USER,
        parts: [
          {
            content: { $case: 'text', value: 'Hello' },
            filename: '',
            mediaType: 'text/plain',
            metadata: undefined,
          },
        ],
        contextId: 'incoming-ctx-id',
        taskId: '',
        extensions: [],
        metadata: {},
      },
    } as SendMessageRequest;
    let capturedContextId: string | undefined;
    (mockAgentExecutor.execute as unknown as Mock).mockImplementation(async (ctx, bus) => {
      capturedContextId = ctx.contextId;
      bus.publish({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
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
        artifacts: [],
        history: [],
      },
      serverCallContext
    );
    const params: SendMessageRequest = {
      tenant: '',
      metadata: {},
      message: {
        messageId: 'msg-ctx2',
        role: Role.ROLE_USER,
        parts: [
          {
            content: { $case: 'text', value: 'Hi' },
            filename: '',
            mediaType: 'text/plain',
            metadata: undefined,
          },
        ],
        taskId,
        contextId: '',
        extensions: [],
        metadata: {},
      },
    } as SendMessageRequest;
    let capturedContextId: string | undefined;
    (mockAgentExecutor.execute as unknown as Mock).mockImplementation(async (ctx, bus) => {
      capturedContextId = ctx.contextId;
      bus.publish({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
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
      metadata: {},
      message: {
        messageId: 'msg-ctx3',
        role: Role.ROLE_USER,
        parts: [
          {
            content: { $case: 'text', value: 'Hey' },
            filename: '',
            mediaType: 'text/plain',
            metadata: undefined,
          },
        ],
        taskId: '',
        contextId: '',
        extensions: [],
        metadata: {},
      },
    } as SendMessageRequest;
    let capturedContextId: string | undefined;
    (mockAgentExecutor.execute as unknown as Mock).mockImplementation(async (ctx, bus) => {
      capturedContextId = ctx.contextId;
      bus.publish({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      });
      bus.finished();
    });
    await handler.sendMessage(params, serverCallContext);
    expect(capturedContextId).to.be.a('string').and.not.empty;
  });

  it('ExecutionEventQueue should be instantiable and return an object', () => {
    const fakeBus = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      publish: vi.fn(),
      finished: vi.fn(),
      removeAllListeners: vi.fn(),
    } as unknown as ExecutionEventBus;
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
      metadata: {},
      message: {
        messageId: messageId,
        role: Role.ROLE_USER,
        parts: [
          {
            content: { $case: 'text', value: userMessageText },
            filename: '',
            mediaType: 'text/plain',
            metadata: undefined,
          },
        ],
        contextId: incomingContextId,
        taskId: incomingTaskId,
        extensions: [],
        metadata: {},
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
          artifacts: [],
          history: [],
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
      artifacts: [],
      history: [],
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

    const agentCardWithExtendedSupport: AgentCard = {
      name: 'Test Agent',
      description: 'An agent for testing purposes',
      version: '1.0.0',
      capabilities: {
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
        extendedAgentCard: true,
      },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [
        {
          id: 'test-skill',
          name: 'Test Skill',
          description: 'A skill for testing',
          tags: ['test'],
          examples: [],
          inputModes: ['text/plain'],
          outputModes: ['text/plain'],
          securityRequirements: [],
        },
      ],
      supportedInterfaces: [],
      provider: undefined,
      documentationUrl: '',
      securitySchemes: {},
      securityRequirements: [],
      signatures: [],
    };

    const extendedAgentCard: AgentCard = {
      name: 'Test ExtendedAgentCard Agent',
      description: 'An agent for testing the extended agent card functionality',
      version: '1.0.0',
      capabilities: {
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
          examples: [],
          inputModes: ['text/plain'],
          outputModes: ['text/plain'],
          securityRequirements: [],
        },
      ],
      supportedInterfaces: [],
      provider: undefined,
      documentationUrl: '',
      securitySchemes: {},
      securityRequirements: [],
      signatures: [],
    };

    it('getAuthenticatedExtendedAgentCard should fail if the agent card does not support extended agent card', async () => {
      let caughtError;
      try {
        await handler.getAuthenticatedExtendedAgentCard(serverCallContext);
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
        await handler.getAuthenticatedExtendedAgentCard(serverCallContext);
      } catch (error: any) {
        caughtError = error;
      } finally {
        expect(caughtError).to.be.instanceOf(ExtendedAgentCardNotConfiguredError);
        expect(caughtError.message).to.contain('Extended Agent Card not configured');
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

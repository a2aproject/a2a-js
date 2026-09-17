import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { DefaultRequestHandler, InMemoryTaskStore, TaskStore } from '../../../src/server/index.js';
import {
  AgentCard,
  GetTaskRequest,
  Message,
  Role,
  SendMessageRequest,
  Task,
  TaskState,
} from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

// Synthetic error Task from _runExecutor when the agent rejects before
// publishing a Task event. Pre-fix the code used a fresh uuidv4() that
// didn't match the bus key, so the client's follow-up getTask threw
// TaskNotFoundError.
describe('DefaultRequestHandler synthetic error Task id (blocking path)', () => {
  let handler: DefaultRequestHandler;
  let taskStore: TaskStore;
  let mockExecutor: MockAgentExecutor;
  let eventBusManager: DefaultExecutionEventBusManager;

  const agentCard: AgentCard = {
    name: 'Error Envelope Agent',
    description: 'Test agent for synthetic-error-Task id assertions',
    version: '1.0.0',
    provider: undefined,
    documentationUrl: '',
    supportedInterfaces: [
      {
        url: 'http://localhost/a2a',
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      extensions: [],
      streaming: true,
      pushNotifications: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };

  const serverContext = new ServerCallContext();

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    mockExecutor = new MockAgentExecutor();
    eventBusManager = new DefaultExecutionEventBusManager();
    handler = new DefaultRequestHandler(agentCard, taskStore, mockExecutor, eventBusManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeMessage = (id: string, text: string, overrides: Partial<Message> = {}): Message => ({
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
    ...overrides,
  });

  it('synthetic Task id matches requestContext.taskId (handler-generated) when message has no taskId', async () => {
    let observedRequestTaskId = '';
    mockExecutor.execute.mockImplementation(async (ctx) => {
      observedRequestTaskId = ctx.taskId;
      throw new Error('boom before any Task event');
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-err-1', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const result = (await handler.sendMessage(params, serverContext)) as Task;

    expect(observedRequestTaskId).not.toBe('');
    expect(result.id).toBe(observedRequestTaskId);
    expect(result.status.state).toBe(TaskState.TASK_STATE_FAILED);
  });

  it('synthetic Task id matches the explicit taskId the client supplied on the incoming message', async () => {
    // Prime the store so _createRequestContext finds the existing task.
    const existingTaskId = 'client-supplied-task-id';
    const existingContextId = 'client-supplied-context-id';
    await taskStore.save(
      {
        id: existingTaskId,
        contextId: existingContextId,
        status: {
          state: TaskState.TASK_STATE_INPUT_REQUIRED,
          message: undefined,
          timestamp: undefined,
        },
        artifacts: [],
        history: [],
        metadata: {},
      },
      serverContext
    );

    let observedRequestTaskId = '';
    mockExecutor.execute.mockImplementation(async (ctx) => {
      observedRequestTaskId = ctx.taskId;
      throw new Error('boom before any Task event');
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-err-2', 'kick off', {
        taskId: existingTaskId,
        contextId: existingContextId,
      }),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const result = (await handler.sendMessage(params, serverContext)) as Task;

    expect(observedRequestTaskId).toBe(existingTaskId);
    expect(result.id).toBe(existingTaskId);
    expect(result.status.state).toBe(TaskState.TASK_STATE_FAILED);
  });

  it('getTask(returnedId) resolves to the FAILED task — synthetic Task is reachable via its returned id', async () => {
    // Regression: pre-fix the fabricated uuidv4() didn't match the bus key.
    const errorMessage = 'agent blew up before publishing a Task';
    mockExecutor.execute.mockRejectedValue(new Error(errorMessage));

    const params: SendMessageRequest = {
      message: makeMessage('msg-err-3', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const sendResult = (await handler.sendMessage(params, serverContext)) as Task;
    expect(sendResult.status.state).toBe(TaskState.TASK_STATE_FAILED);

    const getParams: GetTaskRequest = {
      id: sendResult.id,
      tenant: '',
      historyLength: undefined,
    };
    const loaded = await handler.getTask(getParams, serverContext);
    expect(loaded.id).toBe(sendResult.id);
    expect(loaded.status.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(
      (loaded.status.message?.parts[0].content as { $case: 'text'; value: string }).value
    ).toContain(errorMessage);
  });

  it('synthetic Task carries the original user message in history so subsequent reads see what the client sent', async () => {
    // The synthesis appends the user message to history so the FAILED task is self-describing.
    mockExecutor.execute.mockRejectedValue(new Error('failed before publishing task'));

    const userMessage = makeMessage('msg-err-4', 'please tell me a joke');
    const params: SendMessageRequest = {
      message: userMessage,
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const result = (await handler.sendMessage(params, serverContext)) as Task;
    expect(result.status.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(result.history?.find((m) => m.messageId === userMessage.messageId)).toBeDefined();
  });

  it('non-blocking sendMessage path also returns the synthetic Task with id == requestContext.taskId', async () => {
    // Non-blocking resolves on the first event — which IS the synthetic Task here.
    let observedRequestTaskId = '';
    mockExecutor.execute.mockImplementation(async (ctx) => {
      observedRequestTaskId = ctx.taskId;
      throw new Error('non-blocking boom');
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-err-5', 'kick off'),
      tenant: '',
      configuration: {
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        returnImmediately: true,
      },
      metadata: {},
    };

    const result = (await handler.sendMessage(params, serverContext)) as Task;
    expect(observedRequestTaskId).not.toBe('');
    expect(result.id).toBe(observedRequestTaskId);
    expect(result.status.state).toBe(TaskState.TASK_STATE_FAILED);

    const loaded = await handler.getTask(
      { id: result.id, tenant: '', historyLength: undefined },
      serverContext
    );
    expect(loaded.id).toBe(result.id);
    expect(loaded.status.state).toBe(TaskState.TASK_STATE_FAILED);
  });
});

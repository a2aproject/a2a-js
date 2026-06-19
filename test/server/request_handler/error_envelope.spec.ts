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

/**
 * Coverage for the synthetic error Task fabricated by
 * {@link DefaultRequestHandler._runExecutor} when the agent rejects
 * BEFORE publishing a Task event.
 *
 * The contract verified here:
 *
 *   1. The synthetic Task's `id` matches `requestContext.taskId` — i.e.
 *      the same id under which the event bus is registered and that the
 *      handler hands to the client. Previously the code used
 *      `requestContext.task?.id || uuidv4()`, which fabricated a brand
 *      new UUID divorced from the bus registration key; the client
 *      received an id that produced `TaskNotFoundError` on a subsequent
 *      `getTask` call.
 *
 *   2. A subsequent `getTask(returnedId)` resolves successfully and
 *      yields the FAILED task — proving the synthetic Task is reachable
 *      via the same id returned in the blocking response.
 *
 *   3. When the request supplied an explicit `taskId`, the synthetic
 *      Task uses it verbatim (no UUID round-trip).
 *
 *   4. When the request did NOT supply a `taskId`, the synthetic Task
 *      uses the handler-generated `requestContext.taskId` (the same id
 *      the bus is keyed under), and `getTask` resolves with the
 *      handler-generated id.
 */
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
    // Capture the taskId the handler assigned so we can prove the
    // synthetic error Task uses the SAME id, not a fresh `uuidv4()`.
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
    // First, prime the store with an existing non-terminal task so the
    // handler's `_createRequestContext` finds it and binds the new
    // request to its id (per §3.4.3). Without this, the handler raises
    // `TaskNotFoundError` for an unknown `incomingMessage.taskId`.
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
    // This is the regression test for the bug: previously the
    // synthetic Task used a fabricated `uuidv4()` that did not match
    // any key in the event bus or the task store, so `getTask(id)`
    // raised `TaskNotFoundError`. With the fix, `id ==
    // requestContext.taskId`, and the synthetic Task is persisted via
    // the normal ResultManager → TaskStore drain.
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
    // When the executor fails before publishing a Task, the user
    // message that triggered the request would otherwise be lost from
    // the synthesized Task. The blocking-path synthesis appends the
    // user message to `history` so the FAILED task is self-describing.
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
    // The non-blocking branch resolves on the first published event;
    // the synthetic Task IS that first event when the executor rejects
    // before publishing anything. Confirms the fix is consistent across
    // both branches that share `_runExecutor`.
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

    // And the synthetic Task is reachable via `getTask` afterward.
    const loaded = await handler.getTask(
      { id: result.id, tenant: '', historyLength: undefined },
      serverContext
    );
    expect(loaded.id).toBe(result.id);
    expect(loaded.status.state).toBe(TaskState.TASK_STATE_FAILED);
  });
});

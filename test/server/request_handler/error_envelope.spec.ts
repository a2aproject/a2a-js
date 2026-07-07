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

describe('DefaultRequestHandler executor-failure error envelope (blocking path)', () => {
  let handler: DefaultRequestHandler;
  let taskStore: TaskStore;
  let mockExecutor: MockAgentExecutor;
  let eventBusManager: DefaultExecutionEventBusManager;

  const agentCard: AgentCard = {
    name: 'Error Envelope Agent',
    description: 'Test agent for executor-throw propagation assertions',
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

  it('sendMessage rejects with the original error when executor throws before any Task event', async () => {
    const errorMessage = 'boom before any Task event';
    mockExecutor.execute.mockImplementation(async () => {
      throw new Error(errorMessage);
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-err-1', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    await expect(handler.sendMessage(params, serverContext)).rejects.toThrow(errorMessage);
  });

  it('sendMessage rejects when executor throws AFTER publishing a Task, and store reflects FAILED', async () => {
    const errorMessage = 'boom after publishing task';
    let observedRequestTaskId = '';
    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      observedRequestTaskId = ctx.taskId;
      bus.publish({
        kind: 'task',
        data: {
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
        },
      });
      throw new Error(errorMessage);
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-err-2', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    await expect(handler.sendMessage(params, serverContext)).rejects.toThrow(errorMessage);

    // Store should now hold a FAILED task with the same id.
    expect(observedRequestTaskId).not.toBe('');
    const stored = await taskStore.load(observedRequestTaskId, serverContext);
    expect(stored).toBeDefined();
    expect(stored!.status?.state).toBe(TaskState.TASK_STATE_FAILED);
  });

  it('getTask after executor-throw reflects FAILED status persisted by the drain loop', async () => {
    const errorMessage = 'agent blew up mid-execution';
    let observedRequestTaskId = '';
    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      observedRequestTaskId = ctx.taskId;
      bus.publish({
        kind: 'task',
        data: {
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
        },
      });
      throw new Error(errorMessage);
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-err-3', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    await expect(handler.sendMessage(params, serverContext)).rejects.toThrow(errorMessage);

    const getParams: GetTaskRequest = {
      id: observedRequestTaskId,
      tenant: '',
      historyLength: undefined,
    };
    const loaded = await handler.getTask(getParams, serverContext);
    expect(loaded.id).toBe(observedRequestTaskId);
    expect(loaded.status.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(
      (loaded.status.message?.parts[0].content as { $case: 'text'; value: string }).value
    ).toContain(errorMessage);
  });

  it('sendMessage rejects when executor targets an existing task and throws', async () => {
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

    const errorMessage = 'boom on existing task';
    mockExecutor.execute.mockRejectedValue(new Error(errorMessage));

    const params: SendMessageRequest = {
      message: makeMessage('msg-err-4', 'continue', {
        taskId: existingTaskId,
        contextId: existingContextId,
      }),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    await expect(handler.sendMessage(params, serverContext)).rejects.toThrow(errorMessage);

    // The pre-existing task must be updated to FAILED (not left in
    // INPUT_REQUIRED where the client would keep waiting for it).
    const stored = await taskStore.load(existingTaskId, serverContext);
    expect(stored!.status?.state).toBe(TaskState.TASK_STATE_FAILED);
  });

  it('non-blocking sendMessage: returns the initial Task, then persists FAILED in the background', async () => {
    const errorMessage = 'non-blocking boom after first task';
    let observedRequestTaskId = '';
    let releaseError!: () => void;
    const errorGate = new Promise<void>((resolve) => {
      releaseError = resolve;
    });
    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      observedRequestTaskId = ctx.taskId;
      bus.publish({
        kind: 'task',
        data: {
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
        },
      });
      // Wait until the non-blocking caller has resolved before throwing.
      await errorGate;
      throw new Error(errorMessage);
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
    expect(result.status.state).toBe(TaskState.TASK_STATE_SUBMITTED);
    expect(result.id).toBe(observedRequestTaskId);

    // Let the executor throw; give the background drain a couple of
    // microtasks to persist FAILED.
    releaseError();
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const loaded = await handler.getTask(
      { id: result.id, tenant: '', historyLength: undefined },
      serverContext
    );
    expect(loaded.status.state).toBe(TaskState.TASK_STATE_FAILED);
  });
});

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { DefaultRequestHandler, InMemoryTaskStore, TaskStore } from '../../../src/server/index.js';
import {
  AgentCard,
  Message,
  Role,
  SendMessageRequest,
  StreamResponse,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
} from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { AgentEvent } from '../../../src/server/events/execution_event_bus.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

/**
 * Coverage for the streaming error path in
 * {@link DefaultRequestHandler._runStreamExecutor}.
 *
 * Two scenarios are exercised, mirroring the asymmetry called out in
 * PR 2:
 *
 *   1. Executor throws BEFORE publishing any Task event. Previously
 *      `_runStreamExecutor` silently returned from its `.catch` block
 *      after seeing `resultManager.getCurrentTask()` is undefined,
 *      leaving the SSE consumer with an empty stream and no error
 *      indication. With the fix it now synthesizes BOTH a Task event
 *      (so the stream pattern transitions into TASK_LIFECYCLE per
 *      §3.1.2) AND a statusUpdate(FAILED), using `requestContext.taskId`
 *      as the synthetic Task id.
 *
 *   2. Executor publishes a Task event, then throws. This was already
 *      handled before the fix (only a synthetic statusUpdate(FAILED) is
 *      published; a fresh Task event would violate the §3.1.2 ordering
 *      enforced by `_advanceStreamPattern`). Pinned here as a regression
 *      guard so future refactors don't accidentally re-emit a Task.
 */
describe('DefaultRequestHandler streaming error synthesis (_runStreamExecutor)', () => {
  let handler: DefaultRequestHandler;
  let taskStore: TaskStore;
  let mockExecutor: MockAgentExecutor;
  let eventBusManager: DefaultExecutionEventBusManager;

  const agentCard: AgentCard = {
    name: 'Streaming Errors Agent',
    description: 'Test agent for streaming-error synthesis assertions',
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

  it('executor throws before any Task event: stream yields synthetic Task + statusUpdate(FAILED), not empty', async () => {
    // This is the core regression test for PR 2's streaming half:
    // previously the SSE consumer saw an empty stream, making
    // production debugging impossible. Now the consumer sees a
    // well-formed task-lifecycle terminating in FAILED.
    let observedRequestTaskId = '';
    const errorMessage = 'pre-publish failure in streaming executor';
    mockExecutor.execute.mockImplementation(async (ctx) => {
      observedRequestTaskId = ctx.taskId;
      throw new Error(errorMessage);
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-stream-err-1', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const events: StreamResponse[] = [];
    for await (const event of handler.sendMessageStream(params, serverContext)) {
      events.push(event);
    }

    // Two events: synthetic Task followed by terminal status update.
    expect(events.length).toBe(2);

    // First event: synthetic Task carrying the FAILED state, keyed by
    // `requestContext.taskId` — the same id the bus is registered
    // under and that the client would use for a subsequent
    // `tasks/resubscribe` or `getTask`.
    const taskPayload = events[0].payload as { $case: 'task'; value: Task };
    expect(taskPayload.$case).toBe('task');
    expect(taskPayload.value.id).toBe(observedRequestTaskId);
    expect(taskPayload.value.status?.state).toBe(TaskState.TASK_STATE_FAILED);

    // Second event: statusUpdate(FAILED) referencing the same task id.
    const statusPayload = events[1].payload as {
      $case: 'statusUpdate';
      value: TaskStatusUpdateEvent;
    };
    expect(statusPayload.$case).toBe('statusUpdate');
    expect(statusPayload.value.taskId).toBe(observedRequestTaskId);
    expect(statusPayload.value.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(
      (statusPayload.value.status?.message?.parts[0].content as { $case: 'text'; value: string })
        .value
    ).toContain(errorMessage);
  });

  it('synthetic Task is reachable via taskStore after the stream closes', async () => {
    // The Task event is drained through ResultManager into the store
    // exactly the same way a real executor-published Task would be, so
    // the FAILED state is queryable via getTask afterward.
    const errorMessage = 'reachable after failure';
    mockExecutor.execute.mockRejectedValue(new Error(errorMessage));

    const params: SendMessageRequest = {
      message: makeMessage('msg-stream-err-2', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const events: StreamResponse[] = [];
    for await (const event of handler.sendMessageStream(params, serverContext)) {
      events.push(event);
    }

    const taskPayload = events[0].payload as { $case: 'task'; value: Task };
    const taskId = taskPayload.value.id;

    const stored = await taskStore.load(taskId, serverContext);
    expect(stored).toBeDefined();
    expect(stored!.id).toBe(taskId);
    expect(stored!.status?.state).toBe(TaskState.TASK_STATE_FAILED);
  });

  it('synthetic Task includes the original user message in history', async () => {
    // The stream-error synthesis appends the originating user message
    // to the Task's history so the failed task is self-describing —
    // matches the blocking-path synthesis in `_runExecutor`.
    mockExecutor.execute.mockRejectedValue(new Error('boom'));

    const userMessage = makeMessage('msg-stream-err-3', 'tell me a joke');
    const params: SendMessageRequest = {
      message: userMessage,
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const events: StreamResponse[] = [];
    for await (const event of handler.sendMessageStream(params, serverContext)) {
      events.push(event);
    }

    const taskPayload = events[0].payload as { $case: 'task'; value: Task };
    expect(
      taskPayload.value.history?.find((m) => m.messageId === userMessage.messageId)
    ).toBeDefined();
  });

  it('executor publishes Task then throws: stream yields the original Task + a synthetic FAILED statusUpdate (no duplicate Task)', async () => {
    // Pre-existing behaviour preserved: when the executor has already
    // published a Task event, we must NOT publish a second Task event
    // in the error path (would violate stream-pattern ordering); only
    // a statusUpdate(FAILED) is appended.
    const errorMessage = 'post-publish failure';
    let observedRequestTaskId = '';
    let observedContextId = '';
    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      observedRequestTaskId = ctx.taskId;
      observedContextId = ctx.contextId;
      bus.publish(
        AgentEvent.task({
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
        })
      );
      throw new Error(errorMessage);
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-stream-err-4', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const events: StreamResponse[] = [];
    for await (const event of handler.sendMessageStream(params, serverContext)) {
      events.push(event);
    }

    expect(events.length).toBe(2);

    const firstTask = events[0].payload as { $case: 'task'; value: Task };
    expect(firstTask.$case).toBe('task');
    expect(firstTask.value.id).toBe(observedRequestTaskId);
    // The first Task event was the SUBMITTED one published by the
    // executor before it threw — not a second synthetic FAILED Task.
    expect(firstTask.value.status?.state).toBe(TaskState.TASK_STATE_SUBMITTED);

    const failed = events[1].payload as { $case: 'statusUpdate'; value: TaskStatusUpdateEvent };
    expect(failed.$case).toBe('statusUpdate');
    expect(failed.value.taskId).toBe(observedRequestTaskId);
    expect(failed.value.contextId).toBe(observedContextId);
    expect(failed.value.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(
      (failed.value.status?.message?.parts[0].content as { $case: 'text'; value: string }).value
    ).toContain(errorMessage);
  });

  it('synthetic Task uses the explicit taskId the client supplied on the incoming message', async () => {
    // When the client targets an existing non-terminal task and the
    // executor blows up before publishing, the synthetic Task must use
    // the client-supplied id — same contract as the blocking path.
    const existingTaskId = 'client-supplied-stream-task-id';
    const existingContextId = 'client-supplied-stream-context-id';
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

    mockExecutor.execute.mockRejectedValue(new Error('stream boom on existing task'));

    const params: SendMessageRequest = {
      message: makeMessage('msg-stream-err-5', 'continue', {
        taskId: existingTaskId,
        contextId: existingContextId,
      }),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const events: StreamResponse[] = [];
    for await (const event of handler.sendMessageStream(params, serverContext)) {
      events.push(event);
    }

    expect(events.length).toBe(2);
    const taskPayload = events[0].payload as { $case: 'task'; value: Task };
    expect(taskPayload.value.id).toBe(existingTaskId);
    expect(taskPayload.value.status?.state).toBe(TaskState.TASK_STATE_FAILED);

    const statusPayload = events[1].payload as {
      $case: 'statusUpdate';
      value: TaskStatusUpdateEvent;
    };
    expect(statusPayload.value.taskId).toBe(existingTaskId);
  });

  it('event bus is cleaned up after the stream-error path runs', async () => {
    // FAILED is a terminal state, so `_settleBus` must close the bus
    // and detach it from the manager. Otherwise long-lived listeners
    // (e.g. `trackLatestTaskState`) would leak on each failure.
    let observedRequestTaskId = '';
    mockExecutor.execute.mockImplementation(async (ctx) => {
      observedRequestTaskId = ctx.taskId;
      throw new Error('settle after error');
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-stream-err-6', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    for await (const _event of handler.sendMessageStream(params, serverContext)) {
      void _event;
    }

    // Give `.finally()` a tick to call `_settleBus`.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(eventBusManager.getByTaskId(observedRequestTaskId)).toBeUndefined();
  });
});

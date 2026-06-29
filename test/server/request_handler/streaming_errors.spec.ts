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
import {
  AgentEvent,
  DefaultExecutionEventBus,
} from '../../../src/server/events/execution_event_bus.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

// Streaming error synthesis: if the executor throws before a Task
// event, _runStreamExecutor synthesizes Task + statusUpdate(FAILED).
// If it throws after, only statusUpdate(FAILED) (no fresh Task).
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

  it('does not leak the published-task listener on the success path (regression: gemini-code-assist)', async () => {
    // Regression for the listener leak gemini-code-assist flagged on
    // PR #525: `trackLatestPublishedTask` registers a listener on the
    // bus at the top of `_runStreamExecutor`, but the detach thunk it
    // returns is only invoked inside the `.catch` block. On the
    // success path the `.catch` is skipped, so the listener leaks on
    // the bus — and because the bus is kept alive across
    // INPUT_REQUIRED / AUTH_REQUIRED turns, every follow-up
    // `sendMessageStream` on the same task adds another listener.
    //
    // Strategy: drive several successful INPUT_REQUIRED turns on the
    // same task (so the bus stays alive across turns) and read the
    // bus's internal `eventListeners` map size after each turn
    // settles. With the bug, the map size would grow by 1 per turn
    // (the un-detached `trackLatestPublishedTask` listener). With the
    // fix, the map shrinks back to its baseline after each turn.
    const taskId = 'leak-task-1';
    const contextId = 'leak-context-1';

    // Pre-create the task in the store so the handler binds each
    // follow-up `message/send` to this taskId and finds the bus we
    // install below.
    await taskStore.save(
      {
        id: taskId,
        contextId,
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

    const bus = new DefaultExecutionEventBus();

    // Install the bus into the manager BEFORE the handler is asked to
    // create one, so `createOrGetByTaskId` returns this instance.
    const localBusManager = new DefaultExecutionEventBusManager();
    (localBusManager as unknown as { taskIdToBus: Map<string, unknown> }).taskIdToBus.set(
      taskId,
      bus
    );

    const localHandler = new DefaultRequestHandler(
      agentCard,
      taskStore,
      mockExecutor,
      localBusManager
    );

    // Reach into the bus's private listener map to read its size.
    // The DefaultExecutionEventBus tracks 'event' listeners in a
    // private `Map<Listener, WrappedListener[]>`; counting its size
    // gives us the number of distinct registered `event` listeners.
    const eventListenerCount = (): number =>
      (bus as unknown as { eventListeners: Map<unknown, unknown> }).eventListeners.size;

    // Drive N successful INPUT_REQUIRED turns. Pre-fix, each turn
    // leaks one listener (the `trackLatestPublishedTask` one),
    // monotonically growing the listener map. Post-fix, the size
    // returns to the same baseline after each turn settles.
    const turns = 3;
    const sizesAfterTurns: number[] = [];

    const runInputRequiredTurn = async (turnIdx: number): Promise<void> => {
      mockExecutor.execute.mockImplementationOnce(async (_ctx, busArg) => {
        busArg.publish(
          AgentEvent.task({
            id: taskId,
            contextId,
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
        busArg.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_INPUT_REQUIRED,
              message: undefined,
              timestamp: undefined,
            },
            metadata: {},
          })
        );
      });

      const params: SendMessageRequest = {
        message: makeMessage(`msg-leak-${turnIdx}`, `turn ${turnIdx}`, { taskId, contextId }),
        tenant: '',
        configuration: undefined,
        metadata: {},
      };
      for await (const _event of localHandler.sendMessageStream(params, serverContext)) {
        void _event;
      }
      // Allow `.finally()` (which detaches the tracker listeners) and
      // the queue's stop() (which detaches its own listeners) to run.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Bus must still be alive at INPUT_REQUIRED.
      expect(localBusManager.getByTaskId(taskId)).toBe(bus);
      sizesAfterTurns.push(eventListenerCount());
    };

    for (let i = 0; i < turns; i++) {
      await runInputRequiredTurn(i);
    }

    // After every settled turn, the bus must hold exactly the same
    // number of `event` listeners — the baseline (0 in this setup, but
    // we assert equality rather than zero to stay robust against
    // future infrastructure listeners). A leaking
    // `trackLatestPublishedTask` would make the sequence monotonically
    // increasing (e.g., [1, 2, 3]).
    const baseline = sizesAfterTurns[0];
    for (let i = 1; i < sizesAfterTurns.length; i++) {
      expect(sizesAfterTurns[i]).toBe(baseline);
    }
    // And the baseline itself must be 0: there's no executor running
    // between turns and no live consumer, so nothing should remain
    // attached to the bus.
    expect(baseline).toBe(0);
  });
});

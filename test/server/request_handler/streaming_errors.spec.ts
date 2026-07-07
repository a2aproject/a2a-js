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
} from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import {
  AgentEvent,
  DefaultExecutionEventBus,
} from '../../../src/server/events/execution_event_bus.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

// Streaming failure semantics: the executor throwing must terminate
// the SSE stream via a THROWN exception (which the Express layer
// converts to a terminal `event: error` SSE frame or a pre-flush
// JSON-RPC error envelope). The stream never yields a synthetic
// FAILED Task or FAILED statusUpdate; only the events the executor
// actually published are yielded.
describe('DefaultRequestHandler sendMessageStream executor-failure propagation', () => {
  let handler: DefaultRequestHandler;
  let taskStore: TaskStore;
  let mockExecutor: MockAgentExecutor;
  let eventBusManager: DefaultExecutionEventBusManager;

  const agentCard: AgentCard = {
    name: 'Streaming Errors Agent',
    description: 'Test agent for streaming-error propagation assertions',
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

  const drainStream = async (
    stream: AsyncGenerator<StreamResponse, void, undefined>
  ): Promise<{ events: StreamResponse[]; error?: unknown }> => {
    const events: StreamResponse[] = [];
    try {
      for await (const event of stream) {
        events.push(event);
      }
      return { events };
    } catch (error) {
      return { events, error };
    }
  };

  it('executor throws before any Task event: stream throws immediately with the original error, no events yielded', async () => {
    const errorMessage = 'pre-publish failure in streaming executor';
    mockExecutor.execute.mockImplementation(async () => {
      throw new Error(errorMessage);
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-stream-err-1', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const { events, error } = await drainStream(handler.sendMessageStream(params, serverContext));

    expect(events.length).toBe(0);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(errorMessage);
  });

  it('executor publishes Task then throws: stream yields the Task, then throws the original error', async () => {
    // Client sees the events the executor actually published, then
    // observes the error via a thrown exception (which Express turns
    // into a terminal `event: error` SSE frame post-flush).
    const errorMessage = 'post-publish failure';
    let observedRequestTaskId = '';
    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      observedRequestTaskId = ctx.taskId;
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
      message: makeMessage('msg-stream-err-2', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const { events, error } = await drainStream(handler.sendMessageStream(params, serverContext));

    // Exactly one event yielded (the SUBMITTED Task).
    expect(events.length).toBe(1);
    const taskPayload = events[0].payload as { $case: 'task'; value: Task };
    expect(taskPayload.$case).toBe('task');
    expect(taskPayload.value.id).toBe(observedRequestTaskId);
    expect(taskPayload.value.status?.state).toBe(TaskState.TASK_STATE_SUBMITTED);

    // Then the stream throws the original error — no synthetic FAILED
    // statusUpdate is yielded as a normal frame.
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(errorMessage);
  });

  it('after streaming failure, store reflects FAILED so getTask returns the terminal state', async () => {
    const errorMessage = 'reachable after failure';
    let observedRequestTaskId = '';
    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      observedRequestTaskId = ctx.taskId;
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
      message: makeMessage('msg-stream-err-3', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const { error } = await drainStream(handler.sendMessageStream(params, serverContext));
    expect(error).toBeInstanceOf(Error);

    const stored = await taskStore.load(observedRequestTaskId, serverContext);
    expect(stored).toBeDefined();
    expect(stored!.status?.state).toBe(TaskState.TASK_STATE_FAILED);
  });

  it('streaming failure on an existing task marks that task FAILED in the store', async () => {
    // When the client targeted an existing non-terminal task and the
    // executor throws before publishing anything, the existing task
    // must still be updated to FAILED so the client sees the correct
    // state on a subsequent `getTask`.
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

    const errorMessage = 'stream boom on existing task';
    mockExecutor.execute.mockRejectedValue(new Error(errorMessage));

    const params: SendMessageRequest = {
      message: makeMessage('msg-stream-err-4', 'continue', {
        taskId: existingTaskId,
        contextId: existingContextId,
      }),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const { events, error } = await drainStream(handler.sendMessageStream(params, serverContext));
    expect(events.length).toBe(0);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(errorMessage);

    const stored = await taskStore.load(existingTaskId, serverContext);
    expect(stored!.status?.state).toBe(TaskState.TASK_STATE_FAILED);
  });

  it('event bus is cleaned up after the stream-error path runs', async () => {
    // Errors are terminal for the bus, so `_settleBus` must close
    // the bus and detach it from the manager even though no
    // TASK_STATE_FAILED statusUpdate was seen by `trackLatestTaskState`.
    let observedRequestTaskId = '';
    mockExecutor.execute.mockImplementation(async (ctx) => {
      observedRequestTaskId = ctx.taskId;
      throw new Error('settle after error');
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-stream-err-5', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const { error } = await drainStream(handler.sendMessageStream(params, serverContext));
    expect(error).toBeInstanceOf(Error);

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

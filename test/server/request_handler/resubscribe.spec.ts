import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import {
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryTaskStore,
  TaskStore,
} from '../../../src/server/index.js';
import {
  AgentCard,
  StreamResponse,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
} from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { AgentEvent } from '../../../src/server/events/execution_event_bus.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { TaskNotFoundError, UnsupportedOperationError } from '../../../src/errors.js';
import { TERMINAL_STATE_LIST } from '../../../src/server/utils.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

/**
 * Focused coverage for {@link DefaultRequestHandler.resubscribe} per
 * spec §3.1.6.
 *
 * The contract verified here:
 *
 *   1. **Non-terminal task with NO active bus** — the handler MUST
 *      yield the Task snapshot loaded from the store and close the
 *      stream cleanly. This is the regression scenario for the
 *      previously-thrown `UnsupportedOperationError('No active event
 *      bus...')`, which broke reconnection after server restart,
 *      executor pause, or an INPUT_REQUIRED bus-sleep window. The new
 *      behaviour mirrors a2a-go's `distributedManager.Resubscribe`
 *      (`internal/taskexec/distributed_manager.go:73-82`).
 *
 *   2. **Terminal task** — still throws `UnsupportedOperationError`
 *      per the §3.1.6 errors list (no further events will be
 *      delivered, so a snapshot is not a meaningful response).
 *
 *   3. **Unknown task** — still throws `TaskNotFoundError` per the
 *      §3.1.6 errors list.
 *
 *   4. **Non-terminal task WITH active bus** — the snapshot is still
 *      the first yielded event and live events from the bus are
 *      forwarded afterwards. Pinned as a regression guard so the
 *      no-bus early-return doesn't accidentally short-circuit the
 *      live-bus path.
 */
describe('DefaultRequestHandler.resubscribe (§3.1.6)', () => {
  let handler: DefaultRequestHandler;
  let taskStore: TaskStore;
  let mockExecutor: MockAgentExecutor;
  let eventBusManager: DefaultExecutionEventBusManager;

  const agentCard: AgentCard = {
    name: 'Resubscribe Agent',
    description: 'Test agent for §3.1.6 resubscribe contract',
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

  const makeTask = (
    id: string,
    state: TaskState = TaskState.TASK_STATE_WORKING,
    contextId = `ctx-${id}`
  ): Task => ({
    id,
    contextId,
    status: { state, message: undefined, timestamp: undefined },
    artifacts: [],
    history: [],
    metadata: {},
  });

  it('yields the Task snapshot and closes when no active event bus exists (server-restart scenario)', async () => {
    // Simulates the post-restart / executor-paused / INPUT_REQUIRED
    // bus-sleep scenarios: the task is persisted and non-terminal,
    // but the in-memory `eventBusManager` has nothing for this id.
    // Previously this raised `UnsupportedOperationError` and broke
    // reconnection; the contract is now to yield the snapshot and
    // close the stream cleanly.
    const taskId = 'task-restart';
    const persisted = makeTask(taskId, TaskState.TASK_STATE_WORKING);
    await taskStore.save(persisted, serverContext);

    // Sanity: no bus is registered for this task before resubscribe.
    expect(eventBusManager.getByTaskId(taskId)).toBeUndefined();

    const events: StreamResponse[] = [];
    for await (const event of handler.resubscribe({ id: taskId, tenant: '' }, serverContext)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    const payload = events[0].payload as { $case: 'task'; value: Task };
    expect(payload.$case).toBe('task');
    expect(payload.value).toEqual(persisted);
  });

  it('yields the snapshot when bus is inactive even at INPUT_REQUIRED (post-bus-sleep reconnection)', async () => {
    // INPUT_REQUIRED is a non-terminal state that keeps the bus alive
    // across the original `_settleBus` call, but a long enough idle
    // window (or a different server instance) may have torn it down.
    // The snapshot path must work for INPUT_REQUIRED too — it's one
    // of the primary motivating scenarios for this fix.
    const taskId = 'task-input-required';
    const persisted = makeTask(taskId, TaskState.TASK_STATE_INPUT_REQUIRED);
    await taskStore.save(persisted, serverContext);

    const events: StreamResponse[] = [];
    for await (const event of handler.resubscribe({ id: taskId, tenant: '' }, serverContext)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    const payload = events[0].payload as { $case: 'task'; value: Task };
    expect(payload.value.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
  });

  it('still throws UnsupportedOperationError for terminal tasks', async () => {
    // Per §3.1.6's errors list, terminal tasks are explicitly
    // unsubscribable — there will be no further events to deliver,
    // so a snapshot would mislead the caller into waiting for a
    // stream that will never produce more events.
    for (const state of TERMINAL_STATE_LIST) {
      const taskId = `task-terminal-${state}`;
      await taskStore.save(makeTask(taskId, state as TaskState), serverContext);

      const generator = handler.resubscribe({ id: taskId, tenant: '' }, serverContext);
      await expect(generator.next()).rejects.toThrow(UnsupportedOperationError);
    }
  });

  it('still throws TaskNotFoundError when the task id is unknown', async () => {
    // Per §3.1.6's errors list. The new snapshot path is gated on a
    // successful `taskStore.load` — there is no snapshot to yield
    // when the id is unknown, so the error contract is preserved.
    const generator = handler.resubscribe({ id: 'does-not-exist', tenant: '' }, serverContext);
    await expect(generator.next()).rejects.toThrow(TaskNotFoundError);
  });

  it('throws UnsupportedOperationError if the agent does not advertise streaming', async () => {
    // The capability gate at the top of `resubscribe` must still
    // short-circuit before we even look at the store — re-checked
    // here so the new snapshot path doesn't accidentally bypass it.
    const nonStreamingCard: AgentCard = {
      ...agentCard,
      capabilities: { ...agentCard.capabilities!, streaming: false },
    };
    const nonStreamingHandler = new DefaultRequestHandler(
      nonStreamingCard,
      taskStore,
      mockExecutor,
      eventBusManager
    );
    await taskStore.save(makeTask('any-task'), serverContext);

    const generator = nonStreamingHandler.resubscribe(
      { id: 'any-task', tenant: '' },
      serverContext
    );
    await expect(generator.next()).rejects.toThrow(UnsupportedOperationError);
  });

  it('yields the snapshot first and then forwards live bus events when a bus IS active', async () => {
    // Regression guard: the no-bus early-return must not short-circuit
    // the live-bus path. With an active bus, the snapshot is still
    // the first event and subsequent status updates flow through.
    const taskId = 'task-live-bus';
    const contextId = `ctx-${taskId}`;
    const persisted = makeTask(taskId, TaskState.TASK_STATE_WORKING, contextId);
    await taskStore.save(persisted, serverContext);

    const bus: ExecutionEventBus = eventBusManager.createOrGetByTaskId(taskId);

    const generator = handler.resubscribe({ id: taskId, tenant: '' }, serverContext);
    const iterator = generator[Symbol.asyncIterator]();

    // Pull the snapshot first — must arrive before any live event is
    // published so the consumer always observes the §3.1.6
    // "Task-snapshot as first event" guarantee.
    const first = await iterator.next();
    expect(first.done).toBe(false);
    // The generator's declared return type is `void`, so the
    // `IteratorResult.value` union widens to `StreamResponse | void`
    // even after a `done: false` runtime check — narrow with an
    // explicit cast, matching the convention used elsewhere in this
    // suite (see `default_request_handler.spec.ts:1332`).
    const firstEvent = first.value as StreamResponse;
    const firstPayload = firstEvent.payload as { $case: 'task'; value: Task };
    expect(firstPayload.$case).toBe('task');
    expect(firstPayload.value.id).toBe(taskId);

    // Now publish a live status update and let the executor close
    // the bus so the generator can settle.
    bus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: undefined,
        },
        metadata: {},
      })
    );
    bus.finished();

    const remaining: StreamResponse[] = [];
    for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
      remaining.push(event);
    }

    expect(remaining).toHaveLength(1);
    const livePayload = remaining[0].payload as {
      $case: 'statusUpdate';
      value: TaskStatusUpdateEvent;
    };
    expect(livePayload.$case).toBe('statusUpdate');
    expect(livePayload.value.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
  });
});

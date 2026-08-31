import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DefaultRequestHandler, InMemoryTaskStore, TaskStore } from '../../src/server/index.js';
import { AgentEvent, ExecutionEventBus } from '../../src/server/events/execution_event_bus.js';
import { DefaultExecutionEventBusManager } from '../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../src/server/context.js';
import { RequestContext } from '../../src/server/agent_execution/request_context.js';
import { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';
import { Task, TaskState } from '../../src/types/pb/a2a.js';
import {
  DeferredSettleBusManager,
  DelayingExecutionEventBusManager,
  settlesWithin,
  waitFor,
} from './support/delaying.js';
import { agentCard, drain, lastState, makeParams } from './support/fixtures.js';

// How long the bus withholds each batch before handing it to subscribers. Small
// enough to keep the suite quick, large enough that every event is still
// undelivered when the executor returns — the condition reported on #620.
const BUS_DELAY_MS = 60;

interface Observed {
  taskId: string;
  contextId: string;
}

/**
 * Publishes a Task in `openingState` and returns immediately, leaving the task
 * to be completed by something else later — a proxying executor that has just
 * handed work to another agent.
 */
class OutOfBandExecutor implements AgentExecutor {
  public readonly observed: Observed = { taskId: '', contextId: '' };
  public returned = false;

  constructor(private readonly openingState: TaskState) {}

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    this.observed.taskId = ctx.taskId;
    this.observed.contextId = ctx.contextId;
    bus.publish(
      AgentEvent.task({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: this.openingState, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      })
    );
    this.returned = true;
  }

  async cancelTask(): Promise<void> {}
}

/** Publishes a full lifecycle and returns; delivery still lags behind. */
class CompletingExecutor implements AgentExecutor {
  public readonly observed: Observed = { taskId: '', contextId: '' };

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    this.observed.taskId = ctx.taskId;
    this.observed.contextId = ctx.contextId;
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
    bus.publish(
      AgentEvent.statusUpdate({
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
      })
    );
    bus.publish(
      AgentEvent.statusUpdate({
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: undefined,
        },
        metadata: {},
      })
    );
  }

  async cancelTask(): Promise<void> {}
}

// A bus whose delivery is deferred breaks every state-based settle policy: by
// the time the executor returns, nothing has been observed. These tests pin the
// supported answer — a manager implementing `settleByTaskId` that settles from
// its own drain instead.
describe('delayed event bus (issue #620)', () => {
  let taskStore: TaskStore;
  let busManager: DeferredSettleBusManager;
  const serverContext = new ServerCallContext();

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    busManager = new DeferredSettleBusManager(BUS_DELAY_MS);
  });

  afterEach(() => {
    busManager.disposeAll();
  });

  const makeHandler = (executor: AgentExecutor) =>
    new DefaultRequestHandler(agentCard, taskStore, executor, busManager);

  it('blocking sendMessage resolves once the delayed events are delivered', async () => {
    const executor = new CompletingExecutor();
    const result = (await makeHandler(executor).sendMessage(
      makeParams('delayed-bus-blocking'),
      serverContext
    )) as Task;

    expect(result.id).toBe(executor.observed.taskId);
    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

    const stored = await taskStore.load(result.id, serverContext);
    expect(stored?.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
  });

  it('sendMessageStream yields the full lifecycle and closes', async () => {
    const executor = new CompletingExecutor();
    const events = await drain(
      makeHandler(executor).sendMessageStream(makeParams('delayed-bus-stream'), serverContext)
    );

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].payload?.$case).toBe('task');
    expect(lastState(events)).toBe(TaskState.TASK_STATE_COMPLETED);
  });

  it('the handler delegates the settle decision and observes no state', async () => {
    const executor = new CompletingExecutor();
    await makeHandler(executor).sendMessage(makeParams('delayed-bus-delegates'), serverContext);

    expect(busManager.settleRequests).toHaveLength(1);
    expect(busManager.settleRequests[0].taskId).toBe(executor.observed.taskId);
    // The whole point: the executor published three events, yet the handler saw
    // none of them, so `keepBusAliveStates` could never have worked here.
    expect(busManager.settleRequests[0].lastObservedState).toBeUndefined();
  });

  it('keeps the bus alive past the executor, then releases it once the terminal event lands', async () => {
    const executor = new OutOfBandExecutor(TaskState.TASK_STATE_WORKING);
    const handler = makeHandler(executor);
    const pending = handler.sendMessage(makeParams('delayed-bus-out-of-band'), serverContext);

    await waitFor(() => executor.returned, 'the executor to return');
    await waitFor(
      () => busManager.settleRequests.length === 1,
      'the handler to ask the manager to settle'
    );
    // Bus must survive: the WORKING event has not even been delivered yet.
    expect(busManager.getByTaskId(executor.observed.taskId)).toBeDefined();
    expect(await settlesWithin(pending, BUS_DELAY_MS * 2)).toBe('pending');

    // Something out of band — another agent's webhook, a reader loop —
    // completes the task after the executor is long gone.
    busManager.getByTaskId(executor.observed.taskId)!.publish(
      AgentEvent.statusUpdate({
        taskId: executor.observed.taskId,
        contextId: executor.observed.contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: undefined,
        },
        metadata: {},
      })
    );

    const result = (await pending) as Task;
    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

    await waitFor(
      () => busManager.getByTaskId(executor.observed.taskId) === undefined,
      'the manager to release the bus after delivering the terminal event'
    );
  });

  it('resubscribe attaches to the still-live bus and receives later events', async () => {
    const executor = new OutOfBandExecutor(TaskState.TASK_STATE_WORKING);
    const handler = makeHandler(executor);
    const pending = handler.sendMessage(makeParams('delayed-bus-resubscribe'), serverContext);

    // Resubscribe reads the task from the store first, so wait for the delayed
    // WORKING event to have been delivered and persisted.
    await waitFor(
      async () => (await taskStore.load(executor.observed.taskId, serverContext)) !== undefined,
      'the WORKING task to be persisted'
    );

    const resubscribed = drain(
      handler.resubscribe({ id: executor.observed.taskId, tenant: '' }, serverContext)
    );

    busManager.getByTaskId(executor.observed.taskId)!.publish(
      AgentEvent.statusUpdate({
        taskId: executor.observed.taskId,
        contextId: executor.observed.contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: undefined,
        },
        metadata: {},
      })
    );

    const events = await resubscribed;
    // First frame is the snapshot required by the spec, then the live update.
    expect(events[0].payload?.$case).toBe('task');
    expect(lastState(events)).toBe(TaskState.TASK_STATE_COMPLETED);

    const result = (await pending) as Task;
    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
  });

  describe('without settleByTaskId (default handler policy)', () => {
    let plainManager: DelayingExecutionEventBusManager;

    beforeEach(() => {
      plainManager = new DelayingExecutionEventBusManager(BUS_DELAY_MS);
    });

    afterEach(() => {
      plainManager.disposeAll();
    });

    it('tears the bus down before anything is delivered, and the caller hangs', async () => {
      // Characterises the #620 failure so the seam's necessity is pinned by a
      // test. `keepBusAliveStates` cannot help even when it lists every state:
      // the handler settles on a state it never observed.
      const executor = new CompletingExecutor();
      const everyState = Object.values(TaskState).filter(
        (value): value is TaskState => typeof value === 'number'
      );
      const handler = new DefaultRequestHandler(
        agentCard,
        taskStore,
        executor,
        plainManager,
        undefined,
        undefined,
        undefined,
        undefined,
        { keepBusAliveStates: everyState }
      );

      // Never awaited to completion: it never settles. The reporter's "the task
      // got stuck entirely" is this. Nothing keeps the loop alive once the
      // manager is disposed in afterEach.
      const pending = handler.sendMessage(makeParams('delayed-bus-no-seam'), serverContext);
      pending.catch(() => {});

      await waitFor(
        () => plainManager.getByTaskId(executor.observed.taskId) === undefined,
        'the handler to tear the bus down'
      );

      expect(await settlesWithin(pending, BUS_DELAY_MS * 4)).toBe('pending');
      // Nothing was ever delivered, so nothing was ever persisted either.
      expect(await taskStore.load(executor.observed.taskId, serverContext)).toBeUndefined();
    });

    it.todo(
      'a built-in bounded linger (busLingerMs) would let a delayed bus work without a custom manager — deferred out of Tier 0'
    );
  });

  it('default in-process bus is unaffected by the seam', async () => {
    // Regression guard: the fast path still settles on observed state.
    const defaultManager = new DefaultExecutionEventBusManager();
    const executor = new CompletingExecutor();
    const handler = new DefaultRequestHandler(agentCard, taskStore, executor, defaultManager);

    const result = (await handler.sendMessage(
      makeParams('default-bus-control'),
      serverContext
    )) as Task;

    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    await waitFor(
      () => defaultManager.getByTaskId(executor.observed.taskId) === undefined,
      'the default manager to release the bus'
    );
  });
});

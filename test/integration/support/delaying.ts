/**
 * Test doubles that model a deployment which does NOT use the SDK's default
 * in-process, zero-latency implementations.
 */

import {
  AgentExecutionEvent,
  DefaultExecutionEventBus,
  EventListener,
  ExecutionEventBus,
  ExecutionEventName,
  FinishedListener,
} from '../../../src/server/events/execution_event_bus.js';
import { ExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { InMemoryTaskStore, TaskStore } from '../../../src/server/store.js';
import { ListTasksRequest, ListTasksResponse, Task, TaskState } from '../../../src/types/pb/a2a.js';
import { TERMINAL_STATE_LIST } from '../../../src/server/utils.js';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `predicate` until it returns true or `timeoutMs` elapses. Reports what
 * was being waited for so a failure is legible instead of a bare timeout.
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 5_000,
  intervalMs = 10
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`);
    }
    await sleep(intervalMs);
  }
}

/**
 * Resolves to `'pending'` if `promise` has not settled within `ms`. Used to
 * assert that a call is still outstanding without hanging the test.
 */
export async function settlesWithin<T>(promise: Promise<T>, ms: number): Promise<T | 'pending'> {
  return Promise.race([promise, sleep(ms).then(() => 'pending' as const)]);
}

/**
 * An {@link ExecutionEventBus} that defers delivery. `publish()` and
 * `finished()` append to a queue which is flushed to the delegate one batch at
 * a time, `delayMs` later — mirroring a bus that persists events and replays
 * them from a reader loop.
 *
 * Subscription (`on`/`off`/`once`) is *not* delayed: only delivery is. Events
 * and `finished()` share one queue so `finished()` can never overtake events
 * published before it.
 */
export class DelayingExecutionEventBus implements ExecutionEventBus {
  private readonly delegate: ExecutionEventBus;
  private readonly delayMs: number;
  private readonly pending: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Total events handed to the delegate; useful for delivery assertions. */
  public deliveredCount = 0;

  constructor(delayMs: number, delegate: ExecutionEventBus = new DefaultExecutionEventBus()) {
    this.delayMs = delayMs;
    this.delegate = delegate;
  }

  publish(event: AgentExecutionEvent): void {
    this.enqueue(() => {
      this.deliveredCount += 1;
      this.delegate.publish(event);
    });
  }

  finished(): void {
    this.enqueue(() => this.delegate.finished());
  }

  on(eventName: 'event', listener: EventListener): this;
  on(eventName: 'finished', listener: FinishedListener): this;
  on(eventName: ExecutionEventName, listener: EventListener & FinishedListener): this {
    this.delegate.on(eventName as 'event', listener);
    return this;
  }

  off(eventName: 'event', listener: EventListener): this;
  off(eventName: 'finished', listener: FinishedListener): this;
  off(eventName: ExecutionEventName, listener: EventListener & FinishedListener): this {
    this.delegate.off(eventName as 'event', listener);
    return this;
  }

  once(eventName: 'event', listener: EventListener): this;
  once(eventName: 'finished', listener: FinishedListener): this;
  once(eventName: ExecutionEventName, listener: EventListener & FinishedListener): this {
    this.delegate.once(eventName as 'event', listener);
    return this;
  }

  removeAllListeners(eventName?: ExecutionEventName): this {
    this.delegate.removeAllListeners(eventName);
    return this;
  }

  /** Drops anything still queued and cancels the pending flush. */
  dispose(): void {
    this.pending.length = 0;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private enqueue(action: () => void): void {
    this.pending.push(action);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const batch = this.pending.splice(0, this.pending.length);
      for (const action of batch) action();
      if (this.pending.length > 0) this.scheduleFlush();
    }, this.delayMs);
  }
}

/**
 * Hands out {@link DelayingExecutionEventBus} instances but leaves the settle
 * decision to the request handler — i.e. it does NOT implement
 * `settleByTaskId`.
 */
export class DelayingExecutionEventBusManager implements ExecutionEventBusManager {
  protected readonly buses = new Map<string, DelayingExecutionEventBus>();
  protected readonly delayMs: number;

  constructor(delayMs: number) {
    this.delayMs = delayMs;
  }

  createOrGetByTaskId(taskId: string): ExecutionEventBus {
    let bus = this.buses.get(taskId);
    if (!bus) {
      bus = new DelayingExecutionEventBus(this.delayMs);
      this.buses.set(taskId, bus);
      this.onBusCreated(taskId, bus);
    }
    return bus;
  }

  getByTaskId(taskId: string): ExecutionEventBus | undefined {
    return this.buses.get(taskId);
  }

  cleanupByTaskId(taskId: string): void {
    const bus = this.buses.get(taskId);
    if (bus) {
      bus.removeAllListeners();
      bus.dispose();
    }
    this.buses.delete(taskId);
  }

  /** Clears every bus; call from `afterEach` so no timer outlives a test. */
  disposeAll(): void {
    for (const taskId of [...this.buses.keys()]) this.cleanupByTaskId(taskId);
  }

  protected onBusCreated(_taskId: string, _bus: DelayingExecutionEventBus): void {}
}

/**
 * The supported configuration for a deferred-delivery bus: it implements
 * `settleByTaskId` so the request handler performs no teardown, and settles
 * from its own drain instead — when a terminal status is actually *delivered*
 * to subscribers.
 */
export class DeferredSettleBusManager extends DelayingExecutionEventBusManager {
  /** Records handler settle requests so tests can assert delegation happened. */
  public readonly settleRequests: Array<{
    taskId: string;
    lastObservedState: TaskState | undefined;
  }> = [];

  settleByTaskId(
    taskId: string,
    _eventBus: ExecutionEventBus,
    lastObservedState: TaskState | undefined
  ): void {
    // Deliberately no teardown: our reader loop below decides when the task is
    // really finished. `lastObservedState` is always undefined here because
    // nothing has been delivered yet, which is exactly why the handler's
    // state-based policy cannot be used.
    this.settleRequests.push({ taskId, lastObservedState });
  }

  protected onBusCreated(taskId: string, bus: DelayingExecutionEventBus): void {
    bus.on('event', (event: AgentExecutionEvent) => {
      const state =
        event.kind === 'statusUpdate' || event.kind === 'task'
          ? event.data.status?.state
          : undefined;
      const isTerminal = state !== undefined && TERMINAL_STATE_LIST.includes(state);
      if (!isTerminal && event.kind !== 'message') return;

      // Settle on the next tick, not inline: this listener is registered
      // before the handler's ExecutionEventQueue subscribes, and tearing the
      // bus down mid-dispatch would strip the queue's listener before it sees
      // this very event.
      setTimeout(() => {
        const current = this.buses.get(taskId);
        if (current !== bus) return;
        bus.finished();
        this.cleanupByTaskId(taskId);
      }, 0);
    });
  }
}

/**
 * A {@link TaskStore} with real latency on every operation, delegating to
 * {@link InMemoryTaskStore}. Cloning semantics are unchanged, so this isolates
 * *latency* from the separate question of whether a store returns live
 * references.
 */
export class DelayingTaskStore implements TaskStore {
  private readonly delegate: TaskStore;
  private readonly delayMs: number;

  constructor(delayMs: number, delegate: TaskStore = new InMemoryTaskStore()) {
    this.delayMs = delayMs;
    this.delegate = delegate;
  }

  async save(task: Task, context: ServerCallContext): Promise<void> {
    await sleep(this.delayMs);
    return this.delegate.save(task, context);
  }

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    await sleep(this.delayMs);
    return this.delegate.load(taskId, context);
  }

  async list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse> {
    await sleep(this.delayMs);
    return this.delegate.list(params, context);
  }
}

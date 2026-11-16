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
  private readonly drainCallbacks = new Set<() => void>();
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

  /**
   * Registers a callback invoked once per batch, after every event in it has
   * been handed to every subscriber. A real deferred bus knows when its reader
   * loop finished a batch; this is that signal. Acting on it — rather than
   * inside an event dispatch — is what lets an owner tear the bus down without
   * stripping a subscriber that has not been given the event yet.
   *
   * @returns a function that detaches the callback.
   */
  onDrained(callback: () => void): () => void {
    this.drainCallbacks.add(callback);
    return () => this.drainCallbacks.delete(callback);
  }

  /** Drops anything still queued and cancels the pending flush. */
  dispose(): void {
    this.pending.length = 0;
    this.drainCallbacks.clear();
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
      // Copy: a callback may settle the bus and mutate this set.
      for (const callback of [...this.drainCallbacks]) callback();
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
}

/** True for the events that mean a task will publish nothing further. */
function endsTheTask(event: AgentExecutionEvent): boolean {
  if (event.kind === 'message') return true;
  if (event.kind !== 'statusUpdate' && event.kind !== 'task') return false;
  const state = event.data.status?.state;
  return state !== undefined && TERMINAL_STATE_LIST.includes(state);
}

/**
 * The supported configuration for a deferred-delivery bus: it implements
 * `settleByTaskId`, takes ownership while events are still in flight, and
 * settles from its own drain — when a terminal status is actually *delivered*
 * to subscribers rather than merely published.
 */
export class DeferredSettleBusManager extends DelayingExecutionEventBusManager {
  /** Records handler settle offers so tests can assert delegation happened. */
  public readonly settleRequests: Array<{
    taskId: string;
    lastObservedState: TaskState | undefined;
    tookOwnership: boolean;
  }> = [];

  private readonly watchers = new Map<string, () => void>();

  settleByTaskId(
    taskId: string,
    _eventBus: ExecutionEventBus,
    lastObservedState: TaskState | undefined
  ): boolean {
    // A terminal state has already reached subscribers — the executor outlived
    // its own events. Nothing is left in flight, so let the handler settle this
    // one the ordinary way.
    const alreadyFinished =
      lastObservedState !== undefined && TERMINAL_STATE_LIST.includes(lastObservedState);
    this.settleRequests.push({ taskId, lastObservedState, tookOwnership: !alreadyFinished });
    this.stopWatching(taskId);
    if (alreadyFinished) return false;

    const bus = this.buses.get(taskId);
    if (!bus) return false;

    // Events are still in flight. Take ownership and settle when they land.
    //
    // The terminal event is spotted by a listener, but the teardown happens on
    // the bus's drain signal, once the whole batch has been handed to every
    // subscriber. Tearing down from inside the dispatch instead would strip any
    // subscriber registered after this listener — a `resubscribe` that attached
    // while the task was still running — before it received the event.
    let taskEnded = false;
    const spot: EventListener = (event: AgentExecutionEvent) => {
      if (endsTheTask(event)) taskEnded = true;
    };
    const detachDrain = bus.onDrained(() => {
      if (!taskEnded) return;
      if (this.buses.get(taskId) !== bus) return;
      bus.finished();
      this.cleanupByTaskId(taskId);
    });

    bus.on('event', spot);
    this.watchers.set(taskId, () => {
      detachDrain();
      bus.off('event', spot);
    });
    return true;
  }

  override cleanupByTaskId(taskId: string): void {
    this.stopWatching(taskId);
    super.cleanupByTaskId(taskId);
  }

  /** Detaches anything left watching this task from an earlier turn. */
  private stopWatching(taskId: string): void {
    const detach = this.watchers.get(taskId);
    if (!detach) return;
    this.watchers.delete(taskId);
    detach();
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

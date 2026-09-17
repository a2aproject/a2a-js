import type { TaskState } from '../../index.js';
import { ServerCallContext } from '../context.js';
import { OwnerResolver, resolveUserScope } from '../owner_resolver.js';
import { ScopedStore } from '../utils.js';
import { DefaultExecutionEventBus, ExecutionEventBus } from './execution_event_bus.js';

/**
 * Shared scope used when a caller omits the {@link ServerCallContext}: an
 * empty tenant and the default `'unknown'` owner.
 */
const UNSCOPED_CONTEXT = new ServerCallContext();

/**
 * Owns the lifetime of one {@link ExecutionEventBus} per task.
 *
 * The request handler creates or looks up a bus when a request starts and
 * settles it once the agent executor returns. Implementations are free to
 * back the bus with anything (in-process, database-backed, a message broker)
 * as long as the methods below behave as documented.
 */
export interface ExecutionEventBusManager {
  /**
   * Returns the bus for `taskId`, creating one if it does not exist. Called
   * on the request path before the executor starts, so implementations
   * should be cheap: the signature is synchronous and cannot await I/O.
   */
  createOrGetByTaskId(taskId: string, context?: ServerCallContext): ExecutionEventBus;

  /**
   * Returns the existing bus for `taskId`, or `undefined` if there is none.
   * Unlike {@link createOrGetByTaskId} this never creates one — `resubscribe`
   * uses it to distinguish a live execution from a task with no active
   * executor.
   */
  getByTaskId(taskId: string, context?: ServerCallContext): ExecutionEventBus | undefined;

  /**
   * Releases the bus for `taskId` and detaches its listeners. Call when the
   * execution flow ends; afterwards {@link getByTaskId} returns `undefined`.
   */
  cleanupByTaskId(taskId: string, context?: ServerCallContext): void;

  /**
   * Optional. Offers the manager the chance to decide the fate of a task's
   * event bus once the agent executor returns.
   *
   * Return `true` to take ownership: the request handler then does nothing,
   * and settling the bus — `eventBus.finished()` plus {@link cleanupByTaskId} —
   * becomes this implementation's responsibility, whenever it judges the task
   * to be finished.
   *
   * Return `false` to decline, in which case the handler applies its default
   * policy for this call: close the bus unless the last observed state is one
   * of `DefaultRequestHandlerOptions.keepBusAliveStates`. Declining is
   * per-call, so a manager may own some tasks and leave others alone. Do not
   * settle the bus yourself and also return `false`.
   *
   * When the method is omitted entirely the handler always applies its default
   * policy.
   *
   * `lastObservedState` is the most recent task state *delivered* to
   * subscribers before the executor returned. It is `undefined` when nothing
   * was delivered, which has two very different causes:
   *
   * - the executor published no task or status event at all; or
   * - the bus defers delivery, and the events have not arrived *yet*.
   *
   * The argument cannot distinguish the two. A bus with deferred delivery
   * should therefore treat `undefined` as "not known yet", take ownership, and
   * settle from its own drain — while still handling the case where a terminal
   * state *was* delivered before the executor returned, which can happen when
   * the executor outlives its own events.
   *
   * Taking ownership is safe with respect to callers: `ExecutionEventQueue`
   * terminates on a `message`, a terminal status or an `INPUT_REQUIRED` event
   * and does not depend on `finished()`, so a blocking `sendMessage` still
   * resolves once the real terminal event is delivered. The converse is the
   * risk to weigh: a bus whose owner never settles it, and whose executor
   * never publishes a terminal state, leaks — and a blocking `sendMessage`
   * against it never resolves.
   *
   * @param taskId The task whose bus is being settled.
   * @param eventBus The bus itself, passed so implementations need not look
   *   it up again.
   * @param lastObservedState Most recent state delivered on the bus, or
   *   `undefined` — read the caveat above before branching on it.
   * @param context The server call context. It's up to the manager implementation
   *   to decide if and when to use it.
   * @returns `true` if this manager has taken ownership of the bus, `false` to
   *   let the handler apply its default policy.
   */
  settleByTaskId?(
    taskId: string,
    eventBus: ExecutionEventBus,
    lastObservedState: TaskState | undefined,
    context: ServerCallContext
  ): boolean;
}

/**
 * In-process {@link ExecutionEventBusManager} backed by a `Map`, pairing each
 * task with a {@link DefaultExecutionEventBus}.
 *
 * Deliberately does not implement
 * {@link ExecutionEventBusManager.settleByTaskId}: delivery is synchronous, so
 * the request handler's own state-based settle policy always applies.
 */
export class DefaultExecutionEventBusManager implements ExecutionEventBusManager {
  private readonly _scopedBuses: ScopedStore<ExecutionEventBus>;

  constructor(ownerResolver: OwnerResolver = resolveUserScope) {
    this._scopedBuses = new ScopedStore<ExecutionEventBus>(ownerResolver);
  }

  public createOrGetByTaskId(taskId: string, context?: ServerCallContext): ExecutionEventBus {
    const bucket = this._scopedBuses.getOrCreateBucket(context ?? UNSCOPED_CONTEXT);
    let bus = bucket.get(taskId);
    if (!bus) {
      bus = new DefaultExecutionEventBus();
      bucket.set(taskId, bus);
    }
    return bus;
  }

  public getByTaskId(taskId: string, context?: ServerCallContext): ExecutionEventBus | undefined {
    return this._scopedBuses.getBucket(context ?? UNSCOPED_CONTEXT)?.get(taskId);
  }

  /** Removes the bus for the task. Call when the execution flow ends. */
  public cleanupByTaskId(taskId: string, context?: ServerCallContext): void {
    const bucket = this._scopedBuses.getBucket(context ?? UNSCOPED_CONTEXT);
    bucket?.get(taskId)?.removeAllListeners();
    bucket?.delete(taskId);
  }
}

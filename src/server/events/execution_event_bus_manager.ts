import type { TaskState } from '../../index.js';
import { DefaultExecutionEventBus, ExecutionEventBus } from './execution_event_bus.js';

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
  createOrGetByTaskId(taskId: string): ExecutionEventBus;

  /**
   * Returns the existing bus for `taskId`, or `undefined` if there is none.
   * Unlike {@link createOrGetByTaskId} this never creates one — `resubscribe`
   * uses it to distinguish a live execution from a task with no active
   * executor.
   */
  getByTaskId(taskId: string): ExecutionEventBus | undefined;

  /**
   * Releases the bus for `taskId` and detaches its listeners. Call when the
   * execution flow ends; afterwards {@link getByTaskId} returns `undefined`.
   */
  cleanupByTaskId(taskId: string): void;

  /**
   * Optional. Decides the fate of a task's event bus once the agent executor
   * returns. Implementations take **full ownership** of the outcome: while
   * this method is present the request handler performs no teardown of its
   * own, so an implementation that wants the default behaviour must call both
   * `eventBus.finished()` and {@link cleanupByTaskId} itself.
   *
   * When omitted, the handler applies its own policy — see
   * `DefaultRequestHandlerOptions.keepBusAliveStates`. That option is ignored
   * entirely while this method is present.
   *
   * `lastObservedState` is the most recent task state the handler saw
   * published on the bus before the executor settled. It is `undefined` when
   * nothing was observed, which has two very different causes:
   *
   * - the executor published no task or status event at all; or
   * - the bus defers delivery, and the events have not been delivered *yet*.
   *
   * This argument cannot distinguish the two, so a bus that defers delivery
   * should ignore it and settle from its own drain signal instead.
   *
   * Deferring is safe with respect to callers: `ExecutionEventQueue`
   * terminates on a `message`, a terminal status or an `INPUT_REQUIRED` event
   * and does not depend on `finished()`, so a blocking `sendMessage` still
   * resolves once the real terminal event is delivered. The converse is the
   * risk to weigh: if this method never settles a bus whose executor never
   * publishes a terminal state, that bus leaks and a blocking `sendMessage`
   * against it never resolves.
   *
   * @param taskId The task whose bus is being settled.
   * @param eventBus The bus itself, passed so implementations need not look
   *   it up again.
   * @param lastObservedState Most recent state seen on the bus, or
   *   `undefined` — read the caveat above before branching on it.
   */
  settleByTaskId?(
    taskId: string,
    eventBus: ExecutionEventBus,
    lastObservedState: TaskState | undefined
  ): void;
}

/**
 * In-process {@link ExecutionEventBusManager} backed by a `Map`, pairing each
 * task with a {@link DefaultExecutionEventBus}.
 *
 * Deliberately does not implement
 * {@link ExecutionEventBusManager.settleByTaskId}, so the request handler's
 * own settle policy stays in effect.
 */
export class DefaultExecutionEventBusManager implements ExecutionEventBusManager {
  private taskIdToBus: Map<string, ExecutionEventBus> = new Map();

  public createOrGetByTaskId(taskId: string): ExecutionEventBus {
    if (!this.taskIdToBus.has(taskId)) {
      this.taskIdToBus.set(taskId, new DefaultExecutionEventBus());
    }
    return this.taskIdToBus.get(taskId)!;
  }

  public getByTaskId(taskId: string): ExecutionEventBus | undefined {
    return this.taskIdToBus.get(taskId);
  }

  /** Removes the bus for the task. Call when the execution flow ends. */
  public cleanupByTaskId(taskId: string): void {
    const bus = this.taskIdToBus.get(taskId);
    if (bus) {
      bus.removeAllListeners();
    }
    this.taskIdToBus.delete(taskId);
  }
}

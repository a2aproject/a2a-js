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
 * Manages the live {@link ExecutionEventBus} for each active task.
 */
export interface ExecutionEventBusManager {
  createOrGetByTaskId(taskId: string, context?: ServerCallContext): ExecutionEventBus;
  getByTaskId(taskId: string, context?: ServerCallContext): ExecutionEventBus | undefined;
  cleanupByTaskId(taskId: string, context?: ServerCallContext): void;
}

/**
 * Default {@link ExecutionEventBusManager}, scoped by (tenant, owner, taskId)
 * via {@link ScopedStore} — the same partitioning {@link InMemoryTaskStore}
 * applies, so bus routing and task authorization agree.
 *
 * Pass the SAME {@link OwnerResolver} as in the task store.
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

import { TaskStatus, TaskState, Artifact, Task, Message } from '../index.js';
import { ServerCallContext } from './context.js';
import { OwnerResolver } from './owner_resolver.js';

const TERMINAL_STATE_LIST: TaskState[] = [
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
];
export { TERMINAL_STATE_LIST };

/**
 * Generates a timestamp in ISO 8601 format.
 * @returns The current timestamp as a string.
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Checks if a value is a plain object (excluding arrays and null).
 * @param value The value to check.
 * @returns True if the value is a plain object, false otherwise.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if an object is a TaskStatus update (lacks 'parts').
 * Used to differentiate yielded updates from the handler.
 */
export function isTaskStatusUpdate(update: unknown): update is Omit<TaskStatus, 'timestamp'> {
  // Check if it has 'state' and NOT 'parts' (which Artifacts have)
  return isObject(update) && 'state' in update && !('parts' in update);
}

/**
 * Type guard to check if an object is an Artifact update (has 'parts').
 * Used to differentiate yielded updates from the handler.
 */
export function isArtifactUpdate(update: unknown): update is Artifact {
  // Check if it has 'parts'
  return isObject(update) && 'parts' in update;
}

/**
 * Type guard to check if a SendMessage result is a Task (not a Message).
 * Tasks have a `status` field; Messages have a `role` field.
 */
export function isTask(result: Message | Task): result is Task {
  return 'status' in result;
}

/**
 * Stream ordering patterns per §3.1.2.
 * Used to track which pattern a streaming response follows.
 */
export enum StreamPattern {
  /** First event not yet received — pattern undetermined. */
  UNDETERMINED = 'undetermined',
  /** First event was a Message — stream MUST close immediately after it. */
  MESSAGE_ONLY = 'message-only',
  /** First event was a Task — followed by status/artifact updates until terminal state. */
  TASK_LIFECYCLE = 'task-lifecycle',
}

/**
 * A generic triple-nested Map (tenant -> owner -> key -> value) that provides
 * tenant- and owner-scoped data isolation.
 *
 * Both {@link InMemoryTaskStore} and {@link InMemoryPushNotificationStore} delegate
 * their scoping logic to this class, avoiding duplication of the tenant/owner
 * bucket management code.
 *
 * Per spec §13.1, servers MUST ensure appropriate scope limitation based on the
 * authenticated caller's authorization boundaries.
 *
 * @typeParam T - The value type stored in the innermost Map.
 */
export class ScopedStore<T> {
  private readonly _store: Map<string, Map<string, Map<string, T>>> = new Map();
  private readonly _ownerResolver: OwnerResolver;

  constructor(ownerResolver: OwnerResolver) {
    this._ownerResolver = ownerResolver;
  }

  private _tenantKey(context: ServerCallContext): string {
    return context.tenant ?? '';
  }

  private _ownerKey(context: ServerCallContext): string {
    return this._ownerResolver(context);
  }

  /**
   * Returns the owner-scoped bucket for the given context, or `undefined`
   * if no data exists for that tenant/owner combination.
   */
  getBucket(context: ServerCallContext): Map<string, T> | undefined {
    return this._store.get(this._tenantKey(context))?.get(this._ownerKey(context));
  }

  /**
   * Returns the owner-scoped bucket for the given context, creating the
   * tenant and owner maps if they do not yet exist.
   */
  getOrCreateBucket(context: ServerCallContext): Map<string, T> {
    const tenantKey = this._tenantKey(context);
    let tenantBucket = this._store.get(tenantKey);
    if (!tenantBucket) {
      tenantBucket = new Map();
      this._store.set(tenantKey, tenantBucket);
    }

    const ownerKey = this._ownerKey(context);
    let ownerBucket = tenantBucket.get(ownerKey);
    if (!ownerBucket) {
      ownerBucket = new Map();
      tenantBucket.set(ownerKey, ownerBucket);
    }

    return ownerBucket;
  }
}

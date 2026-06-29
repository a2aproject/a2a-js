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
 * Non-terminal state in which the executor pauses awaiting a fresh
 * follow-up message from the client. Both `execute()` and the blocking
 * consumer's drain loop stop when this state is published.
 */
const INPUT_REQUIRED_STATE_LIST: TaskState[] = [TaskState.TASK_STATE_INPUT_REQUIRED];
export { INPUT_REQUIRED_STATE_LIST };

/**
 * Non-terminal state in which the executor pauses awaiting an out-of-band
 * credential injection. Unlike INPUT_REQUIRED the agent resumes
 * publishing without a follow-up client message, so the stream MUST stay
 * open and a blocking caller MUST be returned a snapshot of the current
 * Task while the event bus keeps draining in the background.
 */
const AUTH_REQUIRED_STATE_LIST: TaskState[] = [TaskState.TASK_STATE_AUTH_REQUIRED];
export { AUTH_REQUIRED_STATE_LIST };

/**
 * Union of {@link INPUT_REQUIRED_STATE_LIST} and
 * {@link AUTH_REQUIRED_STATE_LIST} — non-terminal states in which the
 * executor returns after a single publish. Use this for snapshot checks
 * that don't care about the specific pause reason; lifecycle decisions
 * that differ between the two MUST use the specific lists above.
 */
const INTERRUPTED_STATE_LIST: TaskState[] = [
  ...INPUT_REQUIRED_STATE_LIST,
  ...AUTH_REQUIRED_STATE_LIST,
];
export { INTERRUPTED_STATE_LIST };

/** Returns the current time as an ISO 8601 string. */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/** Type guard for plain objects (excluding arrays and `null`). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Type guard for a TaskStatus update (has `state`, lacks `parts`). */
export function isTaskStatusUpdate(update: unknown): update is Omit<TaskStatus, 'timestamp'> {
  return isObject(update) && 'state' in update && !('parts' in update);
}

/** Type guard for an Artifact update (has `parts`). */
export function isArtifactUpdate(update: unknown): update is Artifact {
  return isObject(update) && 'parts' in update;
}

/**
 * Type guard for a `SendMessage` result that is a Task (not a Message).
 * Tasks have a `status` field; Messages have a `role` field.
 */
export function isTask(result: Message | Task): result is Task {
  return 'status' in result;
}

/** Stream ordering patterns used to track which pattern a stream follows. */
export enum StreamPattern {
  /** First event not yet received — pattern undetermined. */
  UNDETERMINED = 'undetermined',
  /** First event was a Message — stream MUST close immediately after it. */
  MESSAGE_ONLY = 'message-only',
  /** First event was a Task — followed by status/artifact updates until terminal state. */
  TASK_LIFECYCLE = 'task-lifecycle',
}

/**
 * A generic triple-nested Map (tenant -> owner -> key -> value) providing
 * tenant- and owner-scoped data isolation. Both {@link InMemoryTaskStore}
 * and {@link InMemoryPushNotificationStore} delegate their scoping logic
 * to this class.
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

  /** Returns the owner-scoped bucket, or `undefined` if absent. */
  getBucket(context: ServerCallContext): Map<string, T> | undefined {
    return this._store.get(this._tenantKey(context))?.get(this._ownerKey(context));
  }

  /** Returns the owner-scoped bucket, creating intermediate maps as needed. */
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

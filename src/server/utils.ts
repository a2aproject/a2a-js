import { RequestMalformedError } from '../errors/index.js';
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
 * Every named `TaskState` value. Client-supplied state filters are
 * validated against this list so that protobufjs' synthetic
 * `UNRECOGNIZED` (-1) sentinel — or any raw out-of-range number decoded
 * from gRPC/JSON-RPC — is rejected instead of silently matching nothing.
 */
const VALID_TASK_STATE_LIST: TaskState[] = [
  TaskState.TASK_STATE_UNSPECIFIED,
  TaskState.TASK_STATE_SUBMITTED,
  TaskState.TASK_STATE_WORKING,
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_INPUT_REQUIRED,
  TaskState.TASK_STATE_REJECTED,
  TaskState.TASK_STATE_AUTH_REQUIRED,
];
export { VALID_TASK_STATE_LIST };

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
 * Resolves the tenant and owner that scope a caller's data. Every store resolves it this way,
 * so one caller reaches the same data through any of them.
 *
 * An absent tenant is the global bucket. The owner comes from the
 * {@link OwnerResolver}, which supplies its own default for anonymous
 * callers.
 */
export function callerScope(
  context: ServerCallContext,
  ownerResolver: OwnerResolver
): { tenant: string; owner: string } {
  return { tenant: context.tenant ?? '', owner: ownerResolver(context) };
}

/**
 * Scope and identity fields are used as storage keys. They must be strings.
 * '' is a valid one.
 */
export function requireKey(subject: string, field: string, value: string): void {
  if (typeof value !== 'string') {
    throw new Error(`${subject} has no ${field}`);
  }
}

/**
 * Wire format of a `ListTasks` page cursor: `<timestamp>|<id>`, base64. Every task store
 * shares it, so a token means the same thing whichever one issued it.
 */
export function encodePageToken(timestamp: string, id: string): string {
  return Buffer.from(`${timestamp}|${id}`).toString('base64');
}

export function decodePageToken(pageToken: string): { timestamp: string; id: string } {
  try {
    const [timestamp, ...idParts] = Buffer.from(pageToken, 'base64').toString('utf-8').split('|');
    if (idParts.length === 0) {
      throw new RequestMalformedError('Invalid page token format.');
    }
    return { timestamp, id: idParts.join('|') };
  } catch (e) {
    if (e instanceof RequestMalformedError) throw e;
    throw new RequestMalformedError('Token is not a valid base64-encoded cursor.');
  }
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

  /** Returns the owner-scoped bucket, or `undefined` if absent. */
  getBucket(context: ServerCallContext): Map<string, T> | undefined {
    const { tenant, owner } = callerScope(context, this._ownerResolver);
    return this._store.get(tenant)?.get(owner);
  }

  /** Returns the owner-scoped bucket, creating intermediate maps as needed. */
  getOrCreateBucket(context: ServerCallContext): Map<string, T> {
    const { tenant, owner } = callerScope(context, this._ownerResolver);

    let tenantBucket = this._store.get(tenant);
    if (!tenantBucket) {
      tenantBucket = new Map();
      this._store.set(tenant, tenantBucket);
    }

    let ownerBucket = tenantBucket.get(owner);
    if (!ownerBucket) {
      ownerBucket = new Map();
      tenantBucket.set(owner, ownerBucket);
    }

    return ownerBucket;
  }
}

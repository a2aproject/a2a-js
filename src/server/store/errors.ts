/**
 * Custom error types for the distributed TaskStore layer.
 *
 * Error classification follows the principle: distinguish between
 * retryable infrastructure errors and fatal business logic errors.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Base
// ──────────────────────────────────────────────────────────────────────────────

export abstract class TaskStoreError extends Error {
  /** Whether the caller may safely retry this operation. */
  abstract readonly retryable: boolean;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fatal errors (retryable = false)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when load() is called for a taskId that does not exist in the store.
 * Not retryable — the caller must handle the missing-task case explicitly.
 */
export class TaskNotFoundError extends TaskStoreError {
  readonly retryable = false;

  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
  }
}

/**
 * Thrown when a conditional write fails because another writer modified the
 * item concurrently and all retry attempts have been exhausted.
 * Not retryable at the application level — the caller should reload and retry
 * its own business logic.
 */
export class TaskConflictError extends TaskStoreError {
  readonly retryable = false;

  constructor(taskId: string, attempts: number) {
    super(`Optimistic lock conflict on task ${taskId} after ${attempts} attempt(s)`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Retryable errors
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when the underlying storage backend (DynamoDB) is temporarily
 * unavailable or returns a throttling/service error.
 * Retryable — the operation may succeed after a short back-off.
 */
export class StoreUnavailableError extends TaskStoreError {
  readonly retryable = true;

  constructor(operation: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Store unavailable during ${operation}: ${causeMessage}`, cause);
  }
}

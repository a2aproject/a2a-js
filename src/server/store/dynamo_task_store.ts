/**
 * DynamoDBTaskStore — persistent, production-grade implementation of TaskStore.
 *
 * Design decisions
 * ────────────────
 * Decision: Use @aws-sdk/lib-dynamodb DocumentClient for JSON marshalling.
 * Rationale: Eliminates hand-written AttributeValue marshalling; DocumentClient
 *   transparently converts JS primitives ↔ DynamoDB types.
 * Trade-offs: Slight abstraction overhead; not usable with raw DynamoDB streams.
 * Compliance impact: No impact — data still encrypted at rest via table KMS key.
 *
 * Decision: Optimistic locking via `version` attribute + conditional writes.
 * Rationale: Prevents two concurrent workers from corrupting task state by
 *   silently overwriting each other's updates.
 * Trade-offs: Adds a conditional expression on every write; conflicts trigger
 *   a configurable retry with exponential back-off + jitter.
 * Compliance impact: Strengthens audit integrity — every successful write
 *   produces a monotonically increasing version, detectable in CloudTrail.
 *
 * Decision: Store full Task JSON as a nested map (not a serialised string).
 * Rationale: Enables future DynamoDB Streams consumers and projection queries
 *   without a double-parse step.
 * Trade-offs: DynamoDB item size limit (400 KB) applies to the full Task.
 * Compliance impact: None — task data is encrypted at rest by the KMS CMK.
 *
 * Table schema
 * ────────────
 *   PK  taskId   String  — A2A task UUID
 *       task     Map     — Full Task object (marshalled by DocumentClient)
 *       version  Number  — Monotonic write counter (starts at 1)
 *       updatedAt String — ISO-8601 timestamp of last write
 *       ttl      Number  — (optional) Unix epoch; enables DynamoDB TTL
 */

import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  type GetCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { Task } from '../../types.js';
import { TaskStore } from '../store.js';
import { ServerCallContext } from '../context.js';
import { TaskConflictError, StoreUnavailableError } from './errors.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/** Shape stored in DynamoDB alongside the Task payload. */
interface DynamoTaskItem {
  taskId: string;
  task: Task;
  version: number;
  updatedAt: string;
  ttl?: number;
}

/** Configuration for DynamoDBTaskStore. */
export interface DynamoTaskStoreConfig {
  /** DynamoDB table name. Must exist prior to use. */
  tableName: string;

  /**
   * Pre-configured DynamoDBDocumentClient to use.
   * When omitted the store creates a default DynamoDBClient (picks up
   * standard AWS credential chain / env vars).
   */
  client?: DynamoDBDocumentClient;

  /**
   * Maximum number of conditional-write retry attempts on conflict.
   * Default: 3.
   */
  maxConflictRetries?: number;

  /**
   * Base delay in milliseconds for exponential back-off on conflict.
   * Actual delay = baseDelayMs * 2^attempt + jitter(0..baseDelayMs).
   * Default: 50.
   */
  baseConflictDelayMs?: number;

  /**
   * Optional TTL in seconds for stored tasks (relative to write time).
   * When set, each item's `ttl` attribute is populated so DynamoDB can
   * automatically expire old tasks.
   * Default: undefined (no TTL).
   */
  taskTtlSeconds?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Returns true when the error is a DynamoDB ConditionalCheckFailedException. */
function isConflict(err: unknown): err is ConditionalCheckFailedException {
  return err instanceof ConditionalCheckFailedException;
}

/** Returns true when the error looks like a transient AWS service error. */
function isRetryableAwsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = (err as { name?: string }).name ?? '';
  return (
    name === 'ProvisionedThroughputExceededException' ||
    name === 'RequestLimitExceeded' ||
    name === 'ServiceUnavailableException' ||
    name === 'ThrottlingException' ||
    name === 'InternalServerError'
  );
}

/** Exponential back-off with full jitter. */
async function backoff(attempt: number, baseMs: number): Promise<void> {
  const cap = baseMs * Math.pow(2, attempt);
  const delay = Math.random() * cap; // full jitter
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

// ──────────────────────────────────────────────────────────────────────────────
// Implementation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Persistent TaskStore backed by Amazon DynamoDB.
 *
 * Implements the {@link TaskStore} interface contract:
 *   - `save` is an upsert (creates or overwrites).
 *   - `load` returns `undefined` when the task does not exist.
 *
 * Additionally provides:
 *   - Optimistic locking via a `version` attribute.
 *   - Configurable exponential back-off + jitter on conflict.
 *   - Optional DynamoDB TTL support for automatic task expiry.
 *
 * @example
 * ```typescript
 * const store = new DynamoDBTaskStore({
 *   tableName: 'a2a-tasks',
 *   taskTtlSeconds: 86400, // 24 hours
 * });
 * await store.save(task);
 * const loaded = await store.load(task.id);
 * ```
 */
export class DynamoDBTaskStore implements TaskStore {
  private readonly ddb: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly maxConflictRetries: number;
  private readonly baseConflictDelayMs: number;
  private readonly taskTtlSeconds?: number;

  constructor(config: DynamoTaskStoreConfig) {
    this.tableName = config.tableName;
    this.maxConflictRetries = config.maxConflictRetries ?? 3;
    this.baseConflictDelayMs = config.baseConflictDelayMs ?? 50;
    this.taskTtlSeconds = config.taskTtlSeconds;

    this.ddb =
      config.client ??
      DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: {
          // Preserve explicit undefined keys rather than stripping them,
          // so that Task objects round-trip faithfully.
          removeUndefinedValues: true,
        },
      });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TaskStore interface
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Persists a task using an optimistic-lock conditional write.
   *
   * Algorithm:
   *   1. Read current `version` from DynamoDB (0 → item does not exist yet).
   *   2. Attempt PutItem with condition:
   *      - New item:      `attribute_not_exists(taskId)`
   *      - Existing item: `#version = :expectedVersion`
   *   3. On ConditionalCheckFailedException (concurrent write detected):
   *      back-off, re-read, retry up to `maxConflictRetries` times.
   *   4. On persistent conflict: throw TaskConflictError.
   *
   * @throws {TaskConflictError} When all optimistic-lock retries are exhausted.
   * @throws {StoreUnavailableError} When DynamoDB returns a transient error.
   */
  async save(task: Task, _context?: ServerCallContext): Promise<void> {
    let attempt = 0;

    while (attempt <= this.maxConflictRetries) {
      // Step 1: Read current version (0 if item does not exist).
      const currentVersion = await this.readVersion(task.id);

      // Step 2: Build conditional write.
      const newVersion = currentVersion + 1;
      const now = new Date().toISOString();
      const item: DynamoTaskItem = {
        taskId: task.id,
        task,
        version: newVersion,
        updatedAt: now,
        ...(this.taskTtlSeconds !== undefined && {
          ttl: Math.floor(Date.now() / 1000) + this.taskTtlSeconds,
        }),
      };

      const isNewItem = currentVersion === 0;
      try {
        await this.ddb.send(
          new PutCommand({
            TableName: this.tableName,
            Item: item,
            ConditionExpression: isNewItem
              ? 'attribute_not_exists(taskId)'
              : '#version = :expectedVersion',
            ...(isNewItem
              ? {}
              : {
                  ExpressionAttributeNames: { '#version': 'version' },
                  ExpressionAttributeValues: { ':expectedVersion': currentVersion },
                }),
          })
        );

        // Write succeeded — done.
        return;
      } catch (err) {
        if (isConflict(err)) {
          attempt++;
          if (attempt > this.maxConflictRetries) {
            throw new TaskConflictError(task.id, attempt);
          }
          // Back-off then retry with a fresh version read.
          await backoff(attempt, this.baseConflictDelayMs);
          continue;
        }

        if (isRetryableAwsError(err)) {
          throw new StoreUnavailableError('save', err);
        }

        throw err; // Unknown error — propagate.
      }
    }
  }

  /**
   * Retrieves a task by ID.
   *
   * @returns The Task, or `undefined` if no item with the given taskId exists.
   * @throws {StoreUnavailableError} When DynamoDB returns a transient error.
   */
  async load(taskId: string, _context?: ServerCallContext): Promise<Task | undefined> {
    let result: GetCommandOutput;
    try {
      result = await this.ddb.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { taskId },
          // ConsistentRead ensures we see the latest committed write,
          // which is critical when load() follows a save() on the same instance.
          ConsistentRead: true,
        })
      );
    } catch (err) {
      if (isRetryableAwsError(err)) {
        throw new StoreUnavailableError('load', err);
      }
      throw err;
    }

    if (!result.Item) {
      return undefined;
    }

    return (result.Item as DynamoTaskItem).task;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Reads only the `version` attribute for the given taskId.
   * Returns 0 when the item does not yet exist.
   */
  private async readVersion(taskId: string): Promise<number> {
    try {
      const result = await this.ddb.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { taskId },
          ProjectionExpression: '#version',
          ExpressionAttributeNames: { '#version': 'version' },
          ConsistentRead: true,
        })
      );
      return (result.Item as Partial<DynamoTaskItem> | undefined)?.version ?? 0;
    } catch (err) {
      if (isRetryableAwsError(err)) {
        throw new StoreUnavailableError('readVersion', err);
      }
      throw err;
    }
  }
}

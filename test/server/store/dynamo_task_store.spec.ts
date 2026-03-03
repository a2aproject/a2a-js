/**
 * Unit tests for DynamoDBTaskStore.
 *
 * All DynamoDB interactions are mocked via aws-sdk-client-mock so that:
 *   - No real AWS credentials or network calls are required.
 *   - Specific error scenarios (ConditionalCheckFailedException, throttling)
 *     can be injected deterministically.
 *
 * Test structure mirrors the existing pattern in this repo:
 *   describe('DynamoDBTaskStore') → nested describe per method/scenario.
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';

import { DynamoDBTaskStore } from '../../../src/server/store/dynamo_task_store.js';
import {
  TaskConflictError,
  StoreUnavailableError,
} from '../../../src/server/store/errors.js';
import type { Task } from '../../../src/types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const TABLE = 'a2a-tasks-test';

function makeTask(id: string, state: Task['status']['state'] = 'submitted'): Task {
  return {
    id,
    kind: 'task',
    contextId: `ctx-${id}`,
    status: { state, timestamp: '2025-01-01T00:00:00.000Z' },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Builds the DynamoDB item that would be stored (version=1 for new items). */
function storedItem(task: Task, version = 1) {
  return {
    taskId: task.id,
    task,
    version,
    updatedAt: expect.any(String),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('DynamoDBTaskStore', () => {
  // Mock at the DocumentClient level — this intercepts all calls made via the
  // DocumentClient wrapper that the store uses internally.
  const ddbMock = mockClient(DynamoDBDocumentClient);

  // Suppress console.error noise in tests that expect error paths.
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    ddbMock.reset();
  });

  afterEach(() => {
    consoleErrorSpy.mockClear();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // save()
  // ────────────────────────────────────────────────────────────────────────────

  describe('save()', () => {
    describe('new item (no prior version)', () => {
      it('uses attribute_not_exists condition on first write', async () => {
        const task = makeTask('task-001');

        // Simulate empty table: GetCommand (version read) returns no Item.
        ddbMock.on(GetCommand).resolves({ Item: undefined });
        // PutCommand succeeds.
        ddbMock.on(PutCommand).resolves({});

        const store = new DynamoDBTaskStore({ tableName: TABLE });
        await store.save(task);

        // Verify PutCommand was called with the correct condition.
        const putCalls = ddbMock.commandCalls(PutCommand);
        expect(putCalls).toHaveLength(1);

        const input = putCalls[0].args[0].input;
        expect(input.TableName).toBe(TABLE);
        expect(input.ConditionExpression).toBe('attribute_not_exists(taskId)');
        // No ExpressionAttributeNames needed for new-item condition.
        expect(input.ExpressionAttributeNames).toBeUndefined();
        expect((input.Item as { version: number }).version).toBe(1);
        expect((input.Item as { taskId: string }).taskId).toBe(task.id);
      });

      it('stores the full task payload', async () => {
        const task = makeTask('task-002');

        ddbMock.on(GetCommand).resolves({ Item: undefined });
        ddbMock.on(PutCommand).resolves({});

        const store = new DynamoDBTaskStore({ tableName: TABLE });
        await store.save(task);

        const putCalls = ddbMock.commandCalls(PutCommand);
        const storedTask = (putCalls[0].args[0].input.Item as { task: Task }).task;
        expect(storedTask).toEqual(task);
      });

      it('sets TTL attribute when taskTtlSeconds is configured', async () => {
        const task = makeTask('task-ttl');
        const TTL_SECS = 3600;

        ddbMock.on(GetCommand).resolves({ Item: undefined });
        ddbMock.on(PutCommand).resolves({});

        const store = new DynamoDBTaskStore({ tableName: TABLE, taskTtlSeconds: TTL_SECS });
        const before = Math.floor(Date.now() / 1000);
        await store.save(task);
        const after = Math.floor(Date.now() / 1000);

        const putCalls = ddbMock.commandCalls(PutCommand);
        const ttl = (putCalls[0].args[0].input.Item as { ttl?: number }).ttl!;
        expect(ttl).toBeGreaterThanOrEqual(before + TTL_SECS);
        expect(ttl).toBeLessThanOrEqual(after + TTL_SECS);
      });
    });

    describe('existing item (subsequent write)', () => {
      it('uses version = :expectedVersion condition', async () => {
        const task = makeTask('task-003');

        // Simulate existing item at version 2.
        ddbMock.on(GetCommand).resolves({ Item: { version: 2 } });
        ddbMock.on(PutCommand).resolves({});

        const store = new DynamoDBTaskStore({ tableName: TABLE });
        await store.save(task);

        const putCalls = ddbMock.commandCalls(PutCommand);
        expect(putCalls).toHaveLength(1);

        const input = putCalls[0].args[0].input;
        expect(input.ConditionExpression).toBe('#version = :expectedVersion');
        expect(input.ExpressionAttributeNames).toEqual({ '#version': 'version' });
        expect(input.ExpressionAttributeValues).toEqual({ ':expectedVersion': 2 });
        // New version should be 3 (currentVersion + 1).
        expect((input.Item as { version: number }).version).toBe(3);
      });
    });

    describe('optimistic locking retry', () => {
      it('retries on ConditionalCheckFailedException and succeeds within limit', async () => {
        const task = makeTask('task-retry');

        // First two version reads return version 1; third read after retry returns version 2.
        ddbMock
          .on(GetCommand)
          .resolvesOnce({ Item: { version: 1 } }) // attempt 1: read version
          .resolvesOnce({ Item: { version: 2 } }) // attempt 2: re-read after conflict
          .resolves({ Item: { version: 2 } });

        // First PutCommand fails with conflict; second succeeds.
        ddbMock
          .on(PutCommand)
          .rejectsOnce(
            new ConditionalCheckFailedException({
              message: 'The conditional request failed',
              $metadata: {},
            })
          )
          .resolves({});

        const store = new DynamoDBTaskStore({
          tableName: TABLE,
          maxConflictRetries: 3,
          baseConflictDelayMs: 0, // Zero delay for fast tests.
        });

        await expect(store.save(task)).resolves.toBeUndefined();

        // Two PutCommand attempts.
        expect(ddbMock.commandCalls(PutCommand)).toHaveLength(2);
      });

      it('throws TaskConflictError when all retries are exhausted', async () => {
        const task = makeTask('task-conflict');

        // All version reads succeed but every PutCommand fails.
        ddbMock.on(GetCommand).resolves({ Item: { version: 5 } });
        ddbMock.on(PutCommand).rejects(
          new ConditionalCheckFailedException({
            message: 'The conditional request failed',
            $metadata: {},
          })
        );

        const store = new DynamoDBTaskStore({
          tableName: TABLE,
          maxConflictRetries: 2,
          baseConflictDelayMs: 0,
        });

        await expect(store.save(task)).rejects.toThrow(TaskConflictError);
        await expect(store.save(task)).rejects.toThrow(/task-conflict/);
      });

      it('TaskConflictError.retryable is false', async () => {
        const task = makeTask('task-conflict-retryable');

        ddbMock.on(GetCommand).resolves({ Item: { version: 1 } });
        ddbMock.on(PutCommand).rejects(
          new ConditionalCheckFailedException({
            message: 'conflict',
            $metadata: {},
          })
        );

        const store = new DynamoDBTaskStore({
          tableName: TABLE,
          maxConflictRetries: 0,
          baseConflictDelayMs: 0,
        });

        await expect(store.save(task)).rejects.toSatisfy(
          (err: unknown) => err instanceof TaskConflictError && err.retryable === false
        );
      });
    });

    describe('AWS service errors', () => {
      it('wraps throttling error in StoreUnavailableError', async () => {
        const task = makeTask('task-throttled');
        const throttle = Object.assign(new Error('Throughput exceeded'), {
          name: 'ProvisionedThroughputExceededException',
        });

        ddbMock.on(GetCommand).rejects(throttle);

        const store = new DynamoDBTaskStore({ tableName: TABLE });
        await expect(store.save(task)).rejects.toThrow(StoreUnavailableError);
      });

      it('StoreUnavailableError.retryable is true', async () => {
        const task = makeTask('task-unavailable');
        const serviceErr = Object.assign(new Error('Service unavailable'), {
          name: 'ServiceUnavailableException',
        });

        ddbMock.on(GetCommand).rejects(serviceErr);

        const store = new DynamoDBTaskStore({ tableName: TABLE });
        await expect(store.save(task)).rejects.toSatisfy(
          (err: unknown) => err instanceof StoreUnavailableError && err.retryable === true
        );
      });

      it('propagates unknown errors without wrapping', async () => {
        const task = makeTask('task-unknown-err');
        const unknownErr = new TypeError('Unexpected type');

        ddbMock.on(GetCommand).resolves({ Item: undefined });
        ddbMock.on(PutCommand).rejects(unknownErr);

        const store = new DynamoDBTaskStore({ tableName: TABLE });
        await expect(store.save(task)).rejects.toThrow(TypeError);
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // load()
  // ────────────────────────────────────────────────────────────────────────────

  describe('load()', () => {
    it('returns the stored Task when item exists', async () => {
      const task = makeTask('task-load-001');

      ddbMock.on(GetCommand).resolves({
        Item: storedItem(task),
      });

      const store = new DynamoDBTaskStore({ tableName: TABLE });
      const result = await store.load(task.id);

      expect(result).toEqual(task);
    });

    it('returns undefined when item does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const store = new DynamoDBTaskStore({ tableName: TABLE });
      const result = await store.load('non-existent-id');

      expect(result).toBeUndefined();
    });

    it('issues a ConsistentRead GetCommand against the correct table', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const store = new DynamoDBTaskStore({ tableName: TABLE });
      await store.load('task-123');

      const getCalls = ddbMock.commandCalls(GetCommand);
      // One call from readVersion in save is absent here (pure load).
      // The load call itself issues one GetCommand.
      const loadCall = getCalls.find(
        (c) => c.args[0].input.ProjectionExpression === undefined
      );
      expect(loadCall).toBeDefined();
      expect(loadCall!.args[0].input.TableName).toBe(TABLE);
      expect(loadCall!.args[0].input.Key).toEqual({ taskId: 'task-123' });
      expect(loadCall!.args[0].input.ConsistentRead).toBe(true);
    });

    it('wraps throttling error in StoreUnavailableError', async () => {
      const throttle = Object.assign(new Error('Throttled'), {
        name: 'ThrottlingException',
      });
      ddbMock.on(GetCommand).rejects(throttle);

      const store = new DynamoDBTaskStore({ tableName: TABLE });
      await expect(store.load('task-err')).rejects.toThrow(StoreUnavailableError);
    });

    it('propagates unknown errors without wrapping', async () => {
      ddbMock.on(GetCommand).rejects(new RangeError('out of range'));

      const store = new DynamoDBTaskStore({ tableName: TABLE });
      await expect(store.load('task-range')).rejects.toThrow(RangeError);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // save() → load() round-trip
  // ────────────────────────────────────────────────────────────────────────────

  describe('save() then load() round-trip', () => {
    it('load returns identical Task to what was saved', async () => {
      const task = makeTask('task-roundtrip', 'working');

      // save: GetCommand returns no item (new), PutCommand succeeds.
      // load: GetCommand returns the stored item.
      ddbMock
        .on(GetCommand)
        .resolvesOnce({ Item: undefined }) // version read during save
        .resolvesOnce({ Item: storedItem(task) }); // actual load

      ddbMock.on(PutCommand).resolves({});

      const store = new DynamoDBTaskStore({ tableName: TABLE });
      await store.save(task);
      const loaded = await store.load(task.id);

      expect(loaded).toEqual(task);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // TaskStore interface compliance
  // ────────────────────────────────────────────────────────────────────────────

  describe('TaskStore interface compliance', () => {
    it('save() resolves with undefined (void)', async () => {
      const task = makeTask('task-void');
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});

      const store = new DynamoDBTaskStore({ tableName: TABLE });
      const result = await store.save(task);
      expect(result).toBeUndefined();
    });

    it('accepts optional ServerCallContext in save() and load() without error', async () => {
      const task = makeTask('task-ctx');
      const ctx = {} as Parameters<typeof store.save>[1]; // typed as ServerCallContext

      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(PutCommand).resolves({});

      const store = new DynamoDBTaskStore({ tableName: TABLE });
      await expect(store.save(task, ctx)).resolves.toBeUndefined();

      ddbMock.on(GetCommand).resolves({ Item: undefined });
      await expect(store.load(task.id, ctx)).resolves.toBeUndefined();
    });
  });
});

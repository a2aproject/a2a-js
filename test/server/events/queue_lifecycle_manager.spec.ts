/**
 * Unit tests for QueueLifecycleManager.
 *
 * Covers:
 *   1. provision() — queue creation, ARN retrieval, policy setup, SNS subscribe
 *   2. provision() edge cases — idempotency, rollback on subscribe failure
 *   3. teardown() — SNS unsubscribe + queue deletion
 *   4. teardown() edge cases — idempotency, unsubscribe-failure resilience
 *   5. queueName — prefix + instanceId composition, 80-char truncation
 *   6. DLQ config — RedrivePolicy inclusion
 *   7. instanceId — uniqueness across instances
 *
 * All AWS SDK calls are mocked via aws-sdk-client-mock; no real network traffic.
 */

import { describe, it, beforeEach, expect, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';

import { SQSClient, CreateQueueCommand, DeleteQueueCommand, GetQueueAttributesCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { SNSClient, SubscribeCommand, UnsubscribeCommand } from '@aws-sdk/client-sns';

import { QueueLifecycleManager } from '../../../src/server/events/queue_lifecycle_manager.js';
import type { QueueProvisionResult } from '../../../src/server/events/queue_lifecycle_manager.js';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:a2a-events';
const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/a2a-abc';
const QUEUE_ARN = 'arn:aws:sqs:us-east-1:123456789012:a2a-abc';
const SUBSCRIPTION_ARN = 'arn:aws:sns:us-east-1:123456789012:a2a-events:sub-uuid';

// ──────────────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────────────

const sqsMock = mockClient(SQSClient);
const snsMock = mockClient(SNSClient);

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Registers the standard happy-path mock responses. */
function setupHappyPath(): void {
  sqsMock.on(CreateQueueCommand).resolves({ QueueUrl: QUEUE_URL });
  sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: { QueueArn: QUEUE_ARN } });
  sqsMock.on(SetQueueAttributesCommand).resolves({});
  sqsMock.on(DeleteQueueCommand).resolves({});
  snsMock.on(SubscribeCommand).resolves({ SubscriptionArn: SUBSCRIPTION_ARN });
  snsMock.on(UnsubscribeCommand).resolves({});
}

/** Creates a manager wired to the mocked clients. */
function makeManager(overrides: Partial<Parameters<typeof QueueLifecycleManager>[0]> = {}): QueueLifecycleManager {
  return new QueueLifecycleManager({
    snsTopicArn: TOPIC_ARN,
    sqsClient: new SQSClient({}),
    snsClient: new SNSClient({}),
    ...overrides,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('QueueLifecycleManager', () => {
  beforeEach(() => {
    sqsMock.reset();
    snsMock.reset();
    setupHappyPath();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // provision()
  // ────────────────────────────────────────────────────────────────────────────

  describe('provision()', () => {
    it('creates a SQS queue whose name starts with the configured prefix', async () => {
      const mgr = makeManager({ queueNamePrefix: 'my-svc' });
      await mgr.provision();

      const createCalls = sqsMock.commandCalls(CreateQueueCommand);
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0].args[0].input.QueueName).toMatch(/^my-svc-/);
    });

    it('uses the default prefix "a2a" when none is configured', async () => {
      const mgr = makeManager();
      await mgr.provision();

      const [call] = sqsMock.commandCalls(CreateQueueCommand);
      expect(call.args[0].input.QueueName).toMatch(/^a2a-/);
    });

    it('embeds the instanceId in the queue name', async () => {
      const mgr = makeManager();
      await mgr.provision();

      const [call] = sqsMock.commandCalls(CreateQueueCommand);
      expect(call.args[0].input.QueueName).toContain(mgr.instanceId);
    });

    it('sets MessageRetentionPeriod from config (defaults to 300)', async () => {
      const mgr = makeManager({ messageRetentionPeriod: 600 });
      await mgr.provision();

      const [call] = sqsMock.commandCalls(CreateQueueCommand);
      expect(call.args[0].input.Attributes?.MessageRetentionPeriod).toBe('600');
    });

    it('sets VisibilityTimeout from config (defaults to 30)', async () => {
      const mgr = makeManager({ visibilityTimeout: 60 });
      await mgr.provision();

      const [call] = sqsMock.commandCalls(CreateQueueCommand);
      expect(call.args[0].input.Attributes?.VisibilityTimeout).toBe('60');
    });

    it('retrieves the queue ARN via GetQueueAttributes', async () => {
      const mgr = makeManager();
      await mgr.provision();

      const getCalls = sqsMock.commandCalls(GetQueueAttributesCommand);
      expect(getCalls).toHaveLength(1);
      expect(getCalls[0].args[0].input.QueueUrl).toBe(QUEUE_URL);
      expect(getCalls[0].args[0].input.AttributeNames).toContain('QueueArn');
    });

    it('sets a queue Policy that allows SNS to send messages', async () => {
      const mgr = makeManager();
      await mgr.provision();

      const setCalls = sqsMock.commandCalls(SetQueueAttributesCommand);
      expect(setCalls).toHaveLength(1);

      const policy = JSON.parse(setCalls[0].args[0].input.Attributes?.Policy ?? '{}');
      const stmt = policy.Statement[0];
      expect(stmt.Effect).toBe('Allow');
      expect(stmt.Principal.Service).toBe('sns.amazonaws.com');
      expect(stmt.Action).toBe('sqs:SendMessage');
      expect(stmt.Resource).toBe(QUEUE_ARN);
      expect(stmt.Condition.ArnEquals['aws:SourceArn']).toBe(TOPIC_ARN);
    });

    it('subscribes the queue to the SNS topic with protocol=sqs', async () => {
      const mgr = makeManager();
      await mgr.provision();

      const subCalls = snsMock.commandCalls(SubscribeCommand);
      expect(subCalls).toHaveLength(1);
      expect(subCalls[0].args[0].input.TopicArn).toBe(TOPIC_ARN);
      expect(subCalls[0].args[0].input.Protocol).toBe('sqs');
      expect(subCalls[0].args[0].input.Endpoint).toBe(QUEUE_ARN);
    });

    it('keeps RawMessageDelivery=false so the SNS envelope is preserved', async () => {
      const mgr = makeManager();
      await mgr.provision();

      const [subCall] = snsMock.commandCalls(SubscribeCommand);
      expect(subCall.args[0].input.Attributes?.RawMessageDelivery).toBe('false');
    });

    it('returns a QueueProvisionResult with queueUrl, queueArn, subscriptionArn, instanceId', async () => {
      const mgr = makeManager();
      const result = await mgr.provision();

      expect(result).toEqual<QueueProvisionResult>({
        queueUrl: QUEUE_URL,
        queueArn: QUEUE_ARN,
        subscriptionArn: SUBSCRIPTION_ARN,
        instanceId: mgr.instanceId,
      });
    });

    it('marks isProvisioned=true after provision()', async () => {
      const mgr = makeManager();
      expect(mgr.isProvisioned).toBe(false);
      await mgr.provision();
      expect(mgr.isProvisioned).toBe(true);
    });

    it('is idempotent — second call returns cached result without extra AWS calls', async () => {
      const mgr = makeManager();
      const first = await mgr.provision();
      const second = await mgr.provision();

      expect(second).toBe(first); // same object reference
      // Only one CreateQueue call despite two provision() invocations.
      expect(sqsMock.commandCalls(CreateQueueCommand)).toHaveLength(1);
    });

    it('includes DLQ RedrivePolicy when dlqArn is configured', async () => {
      const DLQ_ARN = 'arn:aws:sqs:us-east-1:123456789012:a2a-dlq';
      const mgr = makeManager({ dlqArn: DLQ_ARN, maxReceiveCount: 3 });
      await mgr.provision();

      const [call] = sqsMock.commandCalls(CreateQueueCommand);
      const redrive = JSON.parse(call.args[0].input.Attributes?.RedrivePolicy ?? 'null');
      expect(redrive.deadLetterTargetArn).toBe(DLQ_ARN);
      expect(redrive.maxReceiveCount).toBe('3');
    });

    it('does NOT set RedrivePolicy when dlqArn is not configured', async () => {
      const mgr = makeManager();
      await mgr.provision();

      const [call] = sqsMock.commandCalls(CreateQueueCommand);
      expect(call.args[0].input.Attributes?.RedrivePolicy).toBeUndefined();
    });

    it('rolls back (deletes queue) and rethrows when SNS Subscribe fails', async () => {
      snsMock.on(SubscribeCommand).rejects(new Error('SNS authorization denied'));
      const mgr = makeManager();

      await expect(mgr.provision()).rejects.toThrow('SNS authorization denied');

      // Queue must have been deleted as rollback.
      expect(sqsMock.commandCalls(DeleteQueueCommand)).toHaveLength(1);
      expect(sqsMock.commandCalls(DeleteQueueCommand)[0].args[0].input.QueueUrl).toBe(QUEUE_URL);
      // Manager must not cache a partial result.
      expect(mgr.isProvisioned).toBe(false);
    });

    it('rethrows CreateQueue failure without attempting subscribe', async () => {
      sqsMock.reset();
      sqsMock.on(CreateQueueCommand).rejects(new Error('CreateQueue throttled'));
      const mgr = makeManager();

      await expect(mgr.provision()).rejects.toThrow('CreateQueue throttled');
      expect(snsMock.commandCalls(SubscribeCommand)).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // teardown()
  // ────────────────────────────────────────────────────────────────────────────

  describe('teardown()', () => {
    it('is a no-op when provision() has not been called', async () => {
      const mgr = makeManager();
      await mgr.teardown(); // must not throw

      expect(snsMock.commandCalls(UnsubscribeCommand)).toHaveLength(0);
      expect(sqsMock.commandCalls(DeleteQueueCommand)).toHaveLength(0);
    });

    it('unsubscribes from SNS using the stored subscriptionArn', async () => {
      const mgr = makeManager();
      await mgr.provision();
      await mgr.teardown();

      const unsubCalls = snsMock.commandCalls(UnsubscribeCommand);
      expect(unsubCalls).toHaveLength(1);
      expect(unsubCalls[0].args[0].input.SubscriptionArn).toBe(SUBSCRIPTION_ARN);
    });

    it('deletes the SQS queue using the stored queueUrl', async () => {
      const mgr = makeManager();
      await mgr.provision();
      await mgr.teardown();

      const deleteCalls = sqsMock.commandCalls(DeleteQueueCommand);
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0].args[0].input.QueueUrl).toBe(QUEUE_URL);
    });

    it('clears isProvisioned after successful teardown', async () => {
      const mgr = makeManager();
      await mgr.provision();
      expect(mgr.isProvisioned).toBe(true);
      await mgr.teardown();
      expect(mgr.isProvisioned).toBe(false);
    });

    it('still deletes the queue even when SNS Unsubscribe throws', async () => {
      const mgr = makeManager();
      await mgr.provision();

      // Simulate SNS returning an error (e.g. subscription already deleted).
      snsMock.on(UnsubscribeCommand).rejects(new Error('Subscription not found'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await mgr.teardown(); // must not throw

      // DeleteQueue must still have been called despite unsubscribe failure.
      expect(sqsMock.commandCalls(DeleteQueueCommand)).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledOnce();
      errorSpy.mockRestore();
    });

    it('is idempotent — second teardown() is a no-op', async () => {
      const mgr = makeManager();
      await mgr.provision();
      await mgr.teardown();

      snsMock.reset();
      sqsMock.reset();

      await mgr.teardown(); // second call must not contact AWS
      expect(snsMock.commandCalls(UnsubscribeCommand)).toHaveLength(0);
      expect(sqsMock.commandCalls(DeleteQueueCommand)).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // queueName
  // ────────────────────────────────────────────────────────────────────────────

  describe('queueName', () => {
    it('is ≤80 characters for a typical prefix', () => {
      const mgr = makeManager({ queueNamePrefix: 'a2a' });
      expect(mgr.queueName.length).toBeLessThanOrEqual(80);
    });

    it('truncates to 80 characters when prefix is very long', () => {
      const longPrefix = 'a'.repeat(100);
      const mgr = makeManager({ queueNamePrefix: longPrefix });
      expect(mgr.queueName.length).toBe(80);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // instanceId
  // ────────────────────────────────────────────────────────────────────────────

  describe('instanceId', () => {
    it('is unique across different QueueLifecycleManager instances', () => {
      const a = makeManager();
      const b = makeManager();
      expect(a.instanceId).not.toBe(b.instanceId);
    });

    it('is stable — the same value is returned by provisionResult.instanceId', async () => {
      const mgr = makeManager();
      const result = await mgr.provision();
      expect(result.instanceId).toBe(mgr.instanceId);
    });
  });
});

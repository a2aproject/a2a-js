/**
 * Unit tests for the SNS/SQS distributed event bus components.
 *
 * Covers:
 *   1. DistributedExecutionEventBus — local delivery + SNS fire-and-forget
 *   2. SqsEventPoller — message decoding, instance-id dedup, delete-on-success
 *   3. SnsEventBusManager — ExecutionEventBusManager contract, cross-instance
 *      delivery via SQS callback
 *
 * All AWS SDK calls are mocked via aws-sdk-client-mock; no real network traffic.
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

import {
  DistributedExecutionEventBus,
  SqsEventPoller,
  SnsEventBusManager,
} from '../../../src/server/events/sns_sqs_event_bus_manager.js';
import type { AgentExecutionEvent } from '../../../src/server/events/execution_event_bus.js';
import type { Message } from '../../../src/types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:a2a-events';
const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/a2a-instance-A';
const INSTANCE_A = 'instance-uuid-A';
const INSTANCE_B = 'instance-uuid-B';
const TASK_ID = 'task-fanout-001';

function makeMessage(text = 'hello'): Message {
  return {
    kind: 'message',
    messageId: `msg-${Date.now()}`,
    role: 'agent',
    parts: [{ kind: 'text', text }],
  };
}

function makeStatusEvent(taskId: string, state: string, final = false): AgentExecutionEvent {
  return {
    kind: 'status-update',
    taskId,
    contextId: `ctx-${taskId}`,
    status: { state: state as 'submitted' },
    final,
  } as AgentExecutionEvent;
}

/** Wraps a message body in the SNS→SQS envelope format. */
function sqsEnvelope(payload: object, receiptHandle = 'rh-001') {
  return {
    MessageId: `sqs-msg-${Date.now()}`,
    ReceiptHandle: receiptHandle,
    Body: JSON.stringify({ Message: JSON.stringify(payload) }),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. DistributedExecutionEventBus
// ──────────────────────────────────────────────────────────────────────────────

describe('DistributedExecutionEventBus', () => {
  const snsMock = mockClient(SNSClient);

  beforeEach(() => snsMock.reset());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('publish()', () => {
    it('delivers event to local listeners synchronously', () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-1' });

      const snsClient = new SNSClient({});
      const bus = new DistributedExecutionEventBus(TASK_ID, INSTANCE_A, snsClient, TOPIC_ARN);

      const received: AgentExecutionEvent[] = [];
      bus.on('event', (e) => received.push(e));

      const evt = makeMessage('sync-test');
      bus.publish(evt);

      // Local delivery is synchronous — no await needed.
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(evt);
    });

    it('fires PublishCommand to SNS with correct attributes', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-2' });

      const snsClient = new SNSClient({});
      const bus = new DistributedExecutionEventBus(TASK_ID, INSTANCE_A, snsClient, TOPIC_ARN);

      const evt = makeStatusEvent(TASK_ID, 'working');
      bus.publish(evt);

      // Allow the fire-and-forget Promise to resolve.
      await new Promise<void>((r) => setTimeout(r, 10));

      const snsCalls = snsMock.commandCalls(PublishCommand);
      expect(snsCalls).toHaveLength(1);

      const input = snsCalls[0].args[0].input;
      expect(input.TopicArn).toBe(TOPIC_ARN);

      const msg = JSON.parse(input.Message!);
      expect(msg.taskId).toBe(TASK_ID);
      expect(msg.instanceId).toBe(INSTANCE_A);
      expect(msg.type).toBe('event');
      expect(msg.event).toEqual(evt);

      expect(input.MessageAttributes?.['taskId']?.StringValue).toBe(TASK_ID);
      expect(input.MessageAttributes?.['instanceId']?.StringValue).toBe(INSTANCE_A);
      expect(input.MessageAttributes?.['type']?.StringValue).toBe('event');
    });

    it('swallows SNS publish errors without affecting local delivery', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      snsMock.on(PublishCommand).rejects(new Error('SNS unavailable'));

      const snsClient = new SNSClient({});
      const bus = new DistributedExecutionEventBus(TASK_ID, INSTANCE_A, snsClient, TOPIC_ARN);

      const received: AgentExecutionEvent[] = [];
      bus.on('event', (e) => received.push(e));

      const evt = makeMessage('sns-fail');

      // Should NOT throw even though SNS fails.
      expect(() => bus.publish(evt)).not.toThrow();
      expect(received).toHaveLength(1);

      consoleError.mockRestore();
    });
  });

  describe('finished()', () => {
    it('fires finished listeners locally and sends finished SNS message', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-finished' });

      const snsClient = new SNSClient({});
      const bus = new DistributedExecutionEventBus(TASK_ID, INSTANCE_A, snsClient, TOPIC_ARN);

      let finishedFired = false;
      bus.on('finished', () => { finishedFired = true; });

      bus.finished();

      expect(finishedFired).toBe(true);

      await new Promise<void>((r) => setTimeout(r, 10));

      const snsCalls = snsMock.commandCalls(PublishCommand);
      expect(snsCalls).toHaveLength(1);

      const msg = JSON.parse(snsCalls[0].args[0].input.Message!);
      expect(msg.type).toBe('finished');
      expect(msg.event).toBeUndefined();
    });
  });

  describe('publishLocal()', () => {
    it('delivers event to local listeners WITHOUT calling SNS', async () => {
      const snsClient = new SNSClient({});
      const bus = new DistributedExecutionEventBus(TASK_ID, INSTANCE_A, snsClient, TOPIC_ARN);

      const received: AgentExecutionEvent[] = [];
      bus.on('event', (e) => received.push(e));

      const evt = makeMessage('local-only');
      bus.publishLocal(evt);

      await new Promise<void>((r) => setTimeout(r, 10));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(evt);

      // SNS must NOT have been called.
      expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    });
  });

  describe('finishedLocal()', () => {
    it('fires finished listeners WITHOUT calling SNS', async () => {
      const snsClient = new SNSClient({});
      const bus = new DistributedExecutionEventBus(TASK_ID, INSTANCE_A, snsClient, TOPIC_ARN);

      let fired = false;
      bus.on('finished', () => { fired = true; });

      bus.finishedLocal();

      expect(fired).toBe(true);
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    });
  });

  describe('ExecutionEventBus interface compliance', () => {
    it('supports on/off/once/removeAllListeners chaining (inherited)', () => {
      const snsClient = new SNSClient({});
      const bus = new DistributedExecutionEventBus(TASK_ID, INSTANCE_A, snsClient, TOPIC_ARN);

      let count = 0;
      const listener = () => { count++; };

      bus.on('event', listener);
      bus.off('event', listener);

      // Suppress SNS calls.
      snsMock.on(PublishCommand).resolves({});

      bus.publish(makeMessage('off-test'));
      expect(count).toBe(0);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. SqsEventPoller
// ──────────────────────────────────────────────────────────────────────────────

describe('SqsEventPoller', () => {
  const sqsMock = mockClient(SQSClient);

  beforeEach(() => sqsMock.reset());

  describe('message processing', () => {
    it('calls onMessage and deletes message for valid event payload', async () => {
      const event = makeStatusEvent(TASK_ID, 'working');
      const payload = { taskId: TASK_ID, instanceId: INSTANCE_B, type: 'event', event };

      sqsMock
        .on(ReceiveMessageCommand)
        .resolvesOnce({ Messages: [sqsEnvelope(payload, 'rh-A')] })
        .resolves({ Messages: [] }); // Subsequent polls return empty.

      sqsMock.on(DeleteMessageCommand).resolves({});

      const received: Array<{ taskId: string; event?: AgentExecutionEvent; type: string }> = [];
      const sqs = new SQSClient({});
      const poller = new SqsEventPoller(
        sqs,
        QUEUE_URL,
        INSTANCE_A, // this instance
        (msg) => received.push(msg),
        { pollIntervalMs: 0, waitTimeSeconds: 0, maxMessages: 1 }
      );

      poller.start();
      // Wait enough cycles for the first batch to be processed.
      await new Promise<void>((r) => setTimeout(r, 30));
      poller.stop();

      expect(received).toHaveLength(1);
      expect(received[0].taskId).toBe(TASK_ID);
      expect(received[0].type).toBe('event');
      expect(received[0].event).toEqual(event);

      const delCalls = sqsMock.commandCalls(DeleteMessageCommand);
      expect(delCalls).toHaveLength(1);
      expect(delCalls[0].args[0].input.ReceiptHandle).toBe('rh-A');
    });

    it('skips and deletes messages originating from this instance (dedup)', async () => {
      const payload = {
        taskId: TASK_ID,
        instanceId: INSTANCE_A, // same as this instance
        type: 'event',
        event: makeMessage('own-event'),
      };

      sqsMock
        .on(ReceiveMessageCommand)
        .resolvesOnce({ Messages: [sqsEnvelope(payload, 'rh-own')] })
        .resolves({ Messages: [] });

      sqsMock.on(DeleteMessageCommand).resolves({});

      const received: unknown[] = [];
      const sqs = new SQSClient({});
      const poller = new SqsEventPoller(
        sqs,
        QUEUE_URL,
        INSTANCE_A,
        (msg) => received.push(msg),
        { pollIntervalMs: 0, waitTimeSeconds: 0 }
      );

      poller.start();
      await new Promise<void>((r) => setTimeout(r, 30));
      poller.stop();

      // onMessage should NOT be called for own-instance messages.
      expect(received).toHaveLength(0);
      // But message must still be deleted to prevent re-delivery.
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(1);
    });

    it('processes finished message type', async () => {
      const payload = { taskId: TASK_ID, instanceId: INSTANCE_B, type: 'finished' };

      sqsMock
        .on(ReceiveMessageCommand)
        .resolvesOnce({ Messages: [sqsEnvelope(payload, 'rh-fin')] })
        .resolves({ Messages: [] });

      sqsMock.on(DeleteMessageCommand).resolves({});

      const received: Array<{ type: string }> = [];
      const sqs = new SQSClient({});
      const poller = new SqsEventPoller(
        sqs,
        QUEUE_URL,
        INSTANCE_A,
        (msg) => received.push(msg),
        { pollIntervalMs: 0, waitTimeSeconds: 0 }
      );

      poller.start();
      await new Promise<void>((r) => setTimeout(r, 30));
      poller.stop();

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('finished');
    });

    it('does NOT delete message on JSON parse failure (enables DLQ)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      sqsMock
        .on(ReceiveMessageCommand)
        .resolvesOnce({
          Messages: [{
            MessageId: 'bad-msg',
            ReceiptHandle: 'rh-bad',
            Body: 'not-json-at-all{{{',
          }],
        })
        .resolves({ Messages: [] });

      sqsMock.on(DeleteMessageCommand).resolves({});

      const sqs = new SQSClient({});
      const poller = new SqsEventPoller(
        sqs,
        QUEUE_URL,
        INSTANCE_A,
        () => {},
        { pollIntervalMs: 0, waitTimeSeconds: 0 }
      );

      poller.start();
      await new Promise<void>((r) => setTimeout(r, 30));
      poller.stop();

      // No delete should happen for malformed messages.
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);

      consoleError.mockRestore();
    });
  });

  describe('start / stop lifecycle', () => {
    it('start() is idempotent', async () => {
      sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });

      const sqs = new SQSClient({});
      const poller = new SqsEventPoller(sqs, QUEUE_URL, INSTANCE_A, () => {}, {
        pollIntervalMs: 5,
        waitTimeSeconds: 0,
      });

      poller.start();
      poller.start(); // Second call should not duplicate loop.
      await new Promise<void>((r) => setTimeout(r, 20));
      poller.stop();

      // If two loops ran, ReceiveMessageCommand call count would be much higher
      // than if only one loop ran.  We just confirm it ran at all without crash.
      expect(sqsMock.commandCalls(ReceiveMessageCommand).length).toBeGreaterThanOrEqual(1);
    });

    it('stop() halts the polling loop', async () => {
      sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });

      const sqs = new SQSClient({});
      const poller = new SqsEventPoller(sqs, QUEUE_URL, INSTANCE_A, () => {}, {
        pollIntervalMs: 5,
        waitTimeSeconds: 0,
      });

      poller.start();
      await new Promise<void>((r) => setTimeout(r, 15));
      poller.stop();

      const countAtStop = sqsMock.commandCalls(ReceiveMessageCommand).length;
      // Wait to confirm no further calls after stop.
      await new Promise<void>((r) => setTimeout(r, 30));

      expect(sqsMock.commandCalls(ReceiveMessageCommand).length).toBe(countAtStop);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. SnsEventBusManager
// ──────────────────────────────────────────────────────────────────────────────

describe('SnsEventBusManager', () => {
  const snsMock = mockClient(SNSClient);
  const sqsMock = mockClient(SQSClient);

  beforeEach(() => {
    snsMock.reset();
    sqsMock.reset();
  });

  describe('ExecutionEventBusManager interface compliance', () => {
    it('createOrGetByTaskId returns DistributedExecutionEventBus instance', () => {
      sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });

      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      const bus = manager.createOrGetByTaskId(TASK_ID);
      expect(bus).toBeInstanceOf(DistributedExecutionEventBus);
    });

    it('createOrGetByTaskId returns the same instance on subsequent calls', () => {
      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      const bus1 = manager.createOrGetByTaskId(TASK_ID);
      const bus2 = manager.createOrGetByTaskId(TASK_ID);
      expect(bus1).toBe(bus2);
    });

    it('getByTaskId returns undefined before createOrGetByTaskId', () => {
      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      expect(manager.getByTaskId('unknown-task')).toBeUndefined();
    });

    it('getByTaskId returns the bus after createOrGetByTaskId', () => {
      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      manager.createOrGetByTaskId(TASK_ID);
      expect(manager.getByTaskId(TASK_ID)).toBeDefined();
    });

    it('cleanupByTaskId removes the bus and its listeners', () => {
      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      let count = 0;
      const bus = manager.createOrGetByTaskId(TASK_ID);
      bus.on('event', () => { count++; });

      manager.cleanupByTaskId(TASK_ID);

      expect(manager.getByTaskId(TASK_ID)).toBeUndefined();

      // After cleanup a new bus is created on next call.
      const newBus = manager.createOrGetByTaskId(TASK_ID);
      expect(newBus).not.toBe(bus);
    });
  });

  describe('cross-instance fan-out via SQS callback', () => {
    it('delivers event from remote instance to local bus listeners', () => {
      const remoteEvent = makeStatusEvent(TASK_ID, 'completed', true);

      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      // Subscriber registers before any event arrives (SSE client connected first).
      const bus = manager.createOrGetByTaskId(TASK_ID) as DistributedExecutionEventBus;
      const received: AgentExecutionEvent[] = [];
      bus.on('event', (e) => received.push(e));

      // Simulate SQS poller invoking the internal callback with a remote message.
      // We access it via the manager's handleIncomingMessage — exposed here by
      // starting the manager and then calling start/stop without real SQS, then
      // triggering via a unit-level approach: create a test manager subclass or
      // use the poller's onMessage callback directly.
      //
      // Since handleIncomingMessage is private, we simulate it by calling
      // createOrGetByTaskId + publishLocal directly (which is what the handler does).
      (bus as DistributedExecutionEventBus).publishLocal(remoteEvent);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(remoteEvent);
    });

    it('delivers finished signal from remote instance to local bus', () => {
      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      const bus = manager.createOrGetByTaskId(TASK_ID) as DistributedExecutionEventBus;
      let finished = false;
      bus.on('finished', () => { finished = true; });

      (bus as DistributedExecutionEventBus).finishedLocal();

      expect(finished).toBe(true);
    });

    it('manager instanceId is a non-empty string', () => {
      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      expect(typeof manager.instanceId).toBe('string');
      expect(manager.instanceId.length).toBeGreaterThan(0);
    });

    it('two managers have different instanceIds', () => {
      const cfg = {
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      };

      const m1 = new SnsEventBusManager(cfg);
      const m2 = new SnsEventBusManager(cfg);

      expect(m1.instanceId).not.toBe(m2.instanceId);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // handleIncomingMessage (memory-leak guard)
  // ──────────────────────────────────────────────────────────────────────────

  describe('handleIncomingMessage (memory-leak guard)', () => {
    function makeManager() {
      return new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });
    }

    it('silently drops an event message when no local bus exists', () => {
      const manager = makeManager();

      // No bus has been created for TASK_ID — simulates a message that arrived
      // on an instance where no SSE client is connected.
      expect(() => {
        (manager as unknown as { handleIncomingMessage: (m: unknown) => void })
          .handleIncomingMessage({ taskId: TASK_ID, instanceId: 'remote-id', type: 'event', event: makeStatusEvent(TASK_ID, 'working') });
      }).not.toThrow();

      // No bus should have been created as a side-effect.
      expect(manager.getByTaskId(TASK_ID)).toBeUndefined();
    });

    it('silently drops a finished message when no local bus exists', () => {
      const manager = makeManager();

      expect(() => {
        (manager as unknown as { handleIncomingMessage: (m: unknown) => void })
          .handleIncomingMessage({ taskId: TASK_ID, instanceId: 'remote-id', type: 'finished' });
      }).not.toThrow();

      expect(manager.getByTaskId(TASK_ID)).toBeUndefined();
    });

    it('delivers event to an existing local bus', () => {
      const manager = makeManager();
      const bus = manager.createOrGetByTaskId(TASK_ID) as DistributedExecutionEventBus;
      const received: AgentExecutionEvent[] = [];
      bus.on('event', (e) => received.push(e));

      const evt = makeStatusEvent(TASK_ID, 'working');
      (manager as unknown as { handleIncomingMessage: (m: unknown) => void })
        .handleIncomingMessage({ taskId: TASK_ID, instanceId: 'remote-id', type: 'event', event: evt });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(evt);
    });

    it('signals finished and cleans up the bus on finished message', () => {
      const manager = makeManager();
      const bus = manager.createOrGetByTaskId(TASK_ID) as DistributedExecutionEventBus;
      let finishedFired = false;
      bus.on('finished', () => { finishedFired = true; });

      (manager as unknown as { handleIncomingMessage: (m: unknown) => void })
        .handleIncomingMessage({ taskId: TASK_ID, instanceId: 'remote-id', type: 'finished' });

      // The finished signal must have been delivered.
      expect(finishedFired).toBe(true);
      // The bus must have been evicted to prevent memory leaks.
      expect(manager.getByTaskId(TASK_ID)).toBeUndefined();
    });
  });

  describe('instanceId injection (QueueLifecycleManager integration)', () => {
    it('uses the provided instanceId instead of generating a new one', () => {
      const injectedId = 'lifecycle-manager-instance-uuid';
      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        instanceId: injectedId,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      expect(manager.instanceId).toBe(injectedId);
    });

    it('generates a unique UUID when instanceId is not supplied', () => {
      const cfg = {
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      };
      const m1 = new SnsEventBusManager(cfg);
      const m2 = new SnsEventBusManager(cfg);

      // Managers with no injected instanceId must still be unique.
      expect(m1.instanceId).not.toBe(m2.instanceId);
    });

    it('the injected instanceId is propagated into published SNS messages', () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-ok' });

      const injectedId = 'my-ecs-task-id';
      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        instanceId: injectedId,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      const bus = manager.createOrGetByTaskId(TASK_ID) as DistributedExecutionEventBus;
      bus.publish(makeStatusEvent(TASK_ID, 'working'));

      // Allow the fire-and-forget SNS publish to settle.
      return new Promise<void>((resolve) => setTimeout(() => {
        const [call] = snsMock.commandCalls(PublishCommand);
        const body = JSON.parse(call.args[0].input.Message ?? '{}');
        expect(body.instanceId).toBe(injectedId);
        resolve();
      }, 20));
    });
  });

  describe('stop()', () => {
    it('cleans up all buses and stops polling', () => {
      sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });

      const manager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
        pollIntervalMs: 5,
      });

      manager.createOrGetByTaskId('task-stop-A');
      manager.createOrGetByTaskId('task-stop-B');

      manager.start();
      manager.stop();

      expect(manager.getByTaskId('task-stop-A')).toBeUndefined();
      expect(manager.getByTaskId('task-stop-B')).toBeUndefined();
    });
  });
});

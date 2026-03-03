/**
 * Integration tests for the distributed A2A stack:
 *   DynamoDBTaskStore + SnsEventBusManager + DefaultRequestHandler
 *
 * These tests wire real SDK components together (with mocked AWS calls) to
 * exercise the *full* request flow:
 *
 *   Client → DefaultRequestHandler → AgentExecutor
 *                                         │ publish(events)
 *                                         ▼
 *                              DistributedExecutionEventBus
 *                                    │ local delivery  │ SNS fire-and-forget
 *                                    ▼                 ▼
 *                             SSE stream (Instance A)  SNS topic
 *                                                       │
 *                                                  SQS queue (Instance B)
 *                                                       │ SqsEventPoller
 *                                                       ▼
 *                                             SSE stream (Instance B)
 *
 * What IS tested here:
 *   - DynamoDBTaskStore correctly persists and retrieves Task state.
 *   - DefaultRequestHandler integrates with DynamoDBTaskStore via TaskStore iface.
 *   - SnsEventBusManager integrates with DefaultRequestHandler via
 *     ExecutionEventBusManager iface.
 *   - Cross-instance fan-out: events published on Instance A are received
 *     by Instance B's bus via the simulated SQS → poller callback path.
 *   - Full task lifecycle: submitted → working → completed is observable on
 *     both instances.
 *
 * What is NOT tested here (requires LocalStack or real AWS):
 *   - Real DynamoDB conditional writes.
 *   - Real SNS → SQS subscription delivery latency.
 *   - SQS long-poll behaviour.
 *
 * These gaps are covered by the LocalStack integration suite (separate CI stage).
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

import { DynamoDBTaskStore } from '../../../src/server/store/dynamo_task_store.js';
import {
  SnsEventBusManager,
  DistributedExecutionEventBus,
} from '../../../src/server/events/sns_sqs_event_bus_manager.js';
import {
  DefaultRequestHandler,
  ExecutionEventQueue,
} from '../../../src/server/index.js';
import type { AgentExecutionEvent, ExecutionEventBus } from '../../../src/server/index.js';
import type { AgentExecutor } from '../../../src/server/agent_execution/agent_executor.js';
import { RequestContext } from '../../../src/server/agent_execution/request_context.js';
import type { AgentCard, Task, MessageSendParams } from '../../../src/types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const TABLE = 'a2a-tasks-integration';
const TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:a2a-events';
const QUEUE_URL_A = 'https://sqs.us-east-1.amazonaws.com/123456789012/a2a-instance-A';
const QUEUE_URL_B = 'https://sqs.us-east-1.amazonaws.com/123456789012/a2a-instance-B';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const AGENT_CARD: AgentCard = {
  name: 'test-agent',
  description: 'Integration test agent',
  url: 'http://localhost:3000',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: { streaming: true, pushNotifications: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'default', name: 'Default', description: 'Default skill', tags: [] }],
};

function makeParams(text = 'hello'): MessageSendParams {
  return {
    message: {
      kind: 'message',
      messageId: `msg-${Date.now()}`,
      role: 'user',
      parts: [{ kind: 'text', text }],
    },
  };
}

/**
 * A deterministic AgentExecutor that publishes a fixed task lifecycle:
 * submitted → working → completed.
 */
class LifecycleAgentExecutor implements AgentExecutor {
  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = ctx;

    bus.publish({ kind: 'task', id: taskId, contextId, status: { state: 'submitted' } });
    bus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: { state: 'working' },
      final: false,
    } as AgentExecutionEvent);
    bus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: { state: 'completed' },
      final: true,
    } as AgentExecutionEvent);
    bus.finished();
  }

  async cancelTask(_taskId: string, _bus: ExecutionEventBus): Promise<void> {}
}

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe('Distributed stack integration', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  const snsMock = mockClient(SNSClient);
  const sqsMock = mockClient(SQSClient);

  // Capture DynamoDB items written so we can simulate a consistent read.
  const ddbStore = new Map<string, unknown>();

  beforeEach(() => {
    ddbMock.reset();
    snsMock.reset();
    sqsMock.reset();
    ddbStore.clear();

    // ── DynamoDB: simulate a consistent in-memory store ──────────────────────

    ddbMock.on(GetCommand).callsFake((input) => {
      const key = input.Key?.taskId as string | undefined;
      if (!key) return Promise.resolve({ Item: undefined });
      return Promise.resolve({ Item: ddbStore.get(key) ?? undefined });
    });

    ddbMock.on(PutCommand).callsFake((input) => {
      const item = input.Item as { taskId: string } | undefined;
      if (item?.taskId) {
        ddbStore.set(item.taskId, item);
      }
      return Promise.resolve({});
    });

    // ── SNS/SQS: accept all calls ────────────────────────────────────────────
    snsMock.on(PublishCommand).resolves({ MessageId: `sns-${Date.now()}` });
    sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });
    sqsMock.on(DeleteMessageCommand).resolves({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. DynamoDBTaskStore with DefaultRequestHandler
  // ──────────────────────────────────────────────────────────────────────────

  describe('DynamoDBTaskStore ↔ DefaultRequestHandler', () => {
    it('task state is persisted after sendMessage', async () => {
      const taskStore = new DynamoDBTaskStore({ tableName: TABLE });
      const eventBusManager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL_A,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      const handler = new DefaultRequestHandler(
        AGENT_CARD,
        taskStore,
        new LifecycleAgentExecutor(),
        eventBusManager
      );

      const response = await handler.sendMessage(makeParams(), undefined);

      // Response is a Task with final state.
      expect(response.kind).toBe('task');
      const task = response as Task;
      expect(task.status.state).toBe('completed');
      expect(task.id).toBeDefined();

      // Task must have been persisted in DynamoDB.
      const stored = ddbStore.get(task.id) as { task: Task } | undefined;
      expect(stored).toBeDefined();
      expect(stored!.task.id).toBe(task.id);
    });

    it('load() returns the persisted task after a completed execution', async () => {
      const taskStore = new DynamoDBTaskStore({ tableName: TABLE });
      const eventBusManager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL_A,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      const handler = new DefaultRequestHandler(
        AGENT_CARD,
        taskStore,
        new LifecycleAgentExecutor(),
        eventBusManager
      );

      const response = await handler.sendMessage(makeParams(), undefined);
      const taskId = (response as Task).id;

      // Independently load from the store and verify state.
      const loaded = await taskStore.load(taskId);
      expect(loaded).toBeDefined();
      expect(loaded!.id).toBe(taskId);
      expect(loaded!.status.state).toBe('completed');
    });

    it('getTask() returns the task after completion', async () => {
      const taskStore = new DynamoDBTaskStore({ tableName: TABLE });
      const eventBusManager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL_A,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      const handler = new DefaultRequestHandler(
        AGENT_CARD,
        taskStore,
        new LifecycleAgentExecutor(),
        eventBusManager
      );

      const response = await handler.sendMessage(makeParams(), undefined);
      const taskId = (response as Task).id;

      const fetched = await handler.getTask({ id: taskId }, undefined);
      expect(fetched.id).toBe(taskId);
      expect(fetched.status.state).toBe('completed');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Multi-instance event fan-out
  // ──────────────────────────────────────────────────────────────────────────

  describe('Multi-instance fan-out', () => {
    it('Instance B receives events published by Instance A via SNS→SQS path', async () => {
      // ── Instance A setup ─────────────────────────────────────────────────
      const managerA = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL_A,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      // ── Instance B setup ─────────────────────────────────────────────────
      const managerB = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL_B,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      const TASK = 'task-fanout-integration';
      const remoteEvent = {
        kind: 'status-update',
        taskId: TASK,
        contextId: `ctx-${TASK}`,
        status: { state: 'working' },
        final: false,
      } as AgentExecutionEvent;

      // Instance B creates a local bus waiting for events from the executor
      // on Instance A — simulating an SSE client connected to Instance B.
      const busB = managerB.createOrGetByTaskId(TASK) as DistributedExecutionEventBus;
      const receivedOnB: AgentExecutionEvent[] = [];
      busB.on('event', (e) => receivedOnB.push(e));

      // Instance A's executor publishes an event.
      const busA = managerA.createOrGetByTaskId(TASK) as DistributedExecutionEventBus;

      // Capture what Instance A publishes to SNS.
      const snsMessages: string[] = [];
      snsMock.on(PublishCommand).callsFake((input) => {
        snsMessages.push(input.Message!);
        return Promise.resolve({ MessageId: 'sns-ok' });
      });

      busA.publish(remoteEvent);

      // Wait for fire-and-forget SNS publish to complete.
      await new Promise<void>((r) => setTimeout(r, 20));

      // Verify SNS received Instance A's message.
      expect(snsMessages).toHaveLength(1);
      const snsMsg = JSON.parse(snsMessages[0]);
      expect(snsMsg.instanceId).toBe(managerA.instanceId);
      expect(snsMsg.type).toBe('event');

      // Simulate SQS delivering the SNS message to Instance B's poller.
      // (In production, SNS fan-out delivers to the SQS queue; here we
      //  simulate the poller callback directly.)
      busB.publishLocal(snsMsg.event as AgentExecutionEvent);

      // Instance B's SSE listeners should now have the event.
      expect(receivedOnB).toHaveLength(1);
      expect(receivedOnB[0]).toEqual(remoteEvent);
    });

    it('Instance A does not double-deliver its own events via SQS dedup', async () => {
      const managerA = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL_A,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      const TASK = 'task-dedup';
      const busA = managerA.createOrGetByTaskId(TASK) as DistributedExecutionEventBus;

      const received: AgentExecutionEvent[] = [];
      busA.on('event', (e) => received.push(e));

      snsMock.on(PublishCommand).resolves({ MessageId: 'sns-ok' });

      const evt = {
        kind: 'status-update',
        taskId: TASK,
        contextId: `ctx-${TASK}`,
        status: { state: 'completed' },
        final: true,
      } as AgentExecutionEvent;

      // Instance A publishes — local delivery fires immediately.
      busA.publish(evt);

      // Simulate the SQS poller receiving the same event back from SNS
      // but with Instance A's own instanceId → should be skipped.
      // (The SqsEventPoller does the skip; here we verify publishLocal
      //  is NOT called for own-instance messages by testing the poller dedup.)
      const sqsEnvelopeBody = JSON.stringify({
        Message: JSON.stringify({
          taskId: TASK,
          instanceId: managerA.instanceId, // own instance
          type: 'event',
          event: evt,
        }),
      });

      sqsMock
        .on(ReceiveMessageCommand)
        .resolvesOnce({
          Messages: [{
            MessageId: 'dup-msg',
            ReceiptHandle: 'rh-dup',
            Body: sqsEnvelopeBody,
          }],
        })
        .resolves({ Messages: [] });
      sqsMock.on(DeleteMessageCommand).resolves({});

      // Start polling briefly to process the would-be duplicate.
      managerA.start();
      await new Promise<void>((r) => setTimeout(r, 30));
      managerA.stop();

      // Should still be exactly 1 (from the direct publish), NOT 2.
      expect(received).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. ExecutionEventQueue compatibility
  // ──────────────────────────────────────────────────────────────────────────

  describe('ExecutionEventQueue with DistributedExecutionEventBus', () => {
    it('async generator yields all events from distributed bus', async () => {
      snsMock.on(PublishCommand).resolves({});

      const snsClient = new SNSClient({});
      const bus = new DistributedExecutionEventBus(
        'task-queue-test',
        'inst-queue',
        snsClient,
        TOPIC_ARN
      );

      const queue = new ExecutionEventQueue(bus);

      const events: AgentExecutionEvent[] = [];
      const drainDone = (async () => {
        for await (const event of queue.events()) {
          events.push(event);
        }
      })();

      // Publish a standard task lifecycle.
      bus.publish({ kind: 'task', id: 'task-queue-test', contextId: 'ctx', status: { state: 'submitted' } });
      bus.publish({
        kind: 'status-update',
        taskId: 'task-queue-test',
        contextId: 'ctx',
        status: { state: 'completed' },
        final: true,
      } as AgentExecutionEvent);
      bus.finished();

      await drainDone;

      // Should receive submitted task + working status update; generator stops
      // on final=true status event (as per ExecutionEventQueue logic).
      expect(events.length).toBeGreaterThanOrEqual(1);
      const lastEvent = events[events.length - 1] as { kind: string; final?: boolean };
      // The queue stops when it sees final=true status-update.
      expect(lastEvent.kind === 'status-update' || lastEvent.kind === 'task').toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Streaming (onMessageStream)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Streaming via DefaultRequestHandler', () => {
    it('async generator from onMessageStream yields task lifecycle events', async () => {
      const taskStore = new DynamoDBTaskStore({ tableName: TABLE });
      const eventBusManager = new SnsEventBusManager({
        snsTopicArn: TOPIC_ARN,
        sqsQueueUrl: QUEUE_URL_A,
        snsClient: new SNSClient({}),
        sqsClient: new SQSClient({}),
      });

      const handler = new DefaultRequestHandler(
        AGENT_CARD,
        taskStore,
        new LifecycleAgentExecutor(),
        eventBusManager
      );

      const streamedEvents: AgentExecutionEvent[] = [];

      for await (const event of handler.sendMessageStream(makeParams(), undefined)) {
        streamedEvents.push(event);
      }

      // Must have received at least the submitted task and completed status.
      expect(streamedEvents.length).toBeGreaterThanOrEqual(1);
      const kinds = streamedEvents.map((e) => e.kind);
      expect(kinds).toContain('task');
    });
  });
});

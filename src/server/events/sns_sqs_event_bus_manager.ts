/**
 * SNS/SQS distributed ExecutionEventBusManager — multi-node SSE fan-out.
 *
 * Problem
 * ───────
 * In a multi-instance deployment, the SSE client may land on Instance B while
 * the AgentExecutor runs on Instance A.  The in-process DefaultExecutionEventBus
 * only delivers events locally, so Instance B's SSE stream would hang.
 *
 * Solution
 * ────────
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ Instance A (executor)                                               │
 * │                                                                     │
 * │  AgentExecutor.execute()                                            │
 * │       │ publish(event)                                              │
 * │       ▼                                                             │
 * │  DistributedExecutionEventBus                                       │
 * │       ├─ super.publish(event)  ──► local SSE clients on A          │
 * │       └─ SNS.publish(msg)  ──────► SNS Topic                       │
 * └──────────────────────────────────── │ ─────────────────────────────┘
 *                                       │ fan-out
 *                              ┌────────┴────────┐
 *                          SQS Queue A        SQS Queue B
 *                              │                  │
 *                        SqsPoller A         SqsPoller B
 *                              │                  │
 *                     (skip: own instanceId)  local bus B
 *                                                 │
 *                                          local SSE client B
 *
 * Design decisions
 * ────────────────
 * Decision: Each server instance owns a dedicated SQS queue subscribed to the
 *   shared SNS topic.
 * Rationale: Point-to-point delivery — each instance only processes events
 *   relevant to its own SSE connections.  Scales horizontally: N instances →
 *   N SQS queues, no single-queue bottleneck.
 * Trade-offs: Queue lifecycle is managed by QueueLifecycleManager, which
 *   creates and destroys the queue at process start/stop.  In ECS each task
 *   creates exactly one queue on boot and removes it on SIGTERM.
 * Compliance impact: SQS SSE (server-side encryption) and SNS topic policy must
 *   be configured at the infrastructure layer (CDK stack).  The queue policy
 *   allowing SNS→SQS delivery is applied by QueueLifecycleManager.provision().
 *
 * Decision: Publish to SNS fire-and-forget (non-blocking).
 * Rationale: ExecutionEventBus.publish() is synchronous (void return).  Blocking
 *   the executor while waiting for SNS would stall the entire event pipeline.
 * Trade-offs: Transient SNS publish failures are logged but not retried here.
 *   For critical reliability, enable SNS dead-letter queues at infra level.
 * Compliance impact: Structured error logs include taskId for incident tracing.
 *
 * Decision: De-duplicate using instanceId header in SNS message attributes.
 * Rationale: Instance A's own SQS queue also receives the SNS fan-out.
 *   Without dedup, Instance A's local SSE clients would receive events twice.
 * Trade-offs: instanceId is a random UUID generated at process start.  In
 *   canary deployments two instances of the same version differ by instanceId,
 *   which is the desired behaviour.
 * Compliance impact: instanceId appears in structured logs — useful for
 *   correlating SSE delivery paths in CloudWatch Insights.
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message as SQSMessage,
} from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';

import {
  DefaultExecutionEventBus,
  ExecutionEventBus,
  AgentExecutionEvent,
} from './execution_event_bus.js';
import type { ExecutionEventBusManager } from './execution_event_bus_manager.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/** Wire format of messages published to the SNS topic. */
interface SnsEventMessage {
  /** ID of the A2A task this event belongs to. */
  taskId: string;
  /** Random UUID identifying the originating server instance. */
  instanceId: string;
  /** Discriminator: 'event' carries a payload; 'finished' signals termination. */
  type: 'event' | 'finished';
  /** Present only when type === 'event'. */
  event?: AgentExecutionEvent;
}

/** Configuration object for SnsEventBusManager. */
export interface SnsEventBusConfig {
  /** ARN of the SNS topic used for cross-instance fan-out. */
  snsTopicArn: string;
  /** URL of the SQS queue assigned to this server instance. */
  sqsQueueUrl: string;
  /**
   * Unique identifier for this server instance.
   *
   * When using `QueueLifecycleManager`, pass `provisionResult.instanceId` here
   * so that both components share the same identity (critical for dedup).
   *
   * If omitted a random UUID is generated, which is correct for standalone use
   * but will cause double-delivery if the queue was created under a different ID.
   */
  instanceId?: string;
  /** Interval between SQS long-poll cycles in milliseconds. Default: 1000. */
  pollIntervalMs?: number;
  /** SQS long-poll wait time in seconds (0-20). Default: 5. */
  waitTimeSeconds?: number;
  /** Maximum messages per SQS receive call (1-10). Default: 10. */
  maxMessages?: number;
  /** Pre-configured SNS client. Falls back to default credential chain. */
  snsClient?: SNSClient;
  /** Pre-configured SQS client. Falls back to default credential chain. */
  sqsClient?: SQSClient;
}

// ──────────────────────────────────────────────────────────────────────────────
// DistributedExecutionEventBus
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extends DefaultExecutionEventBus to additionally publish events to an SNS
 * topic for cross-instance fan-out.
 *
 * Local delivery (same instance) is immediate and synchronous via the parent.
 * Remote delivery is fire-and-forget via SNS.
 *
 * When the SQS poller on a remote instance receives the message it calls
 * `publishLocal()` / `finishedLocal()` to deliver into the local bus
 * *without* re-triggering another SNS publish (preventing infinite loops).
 */
export class DistributedExecutionEventBus extends DefaultExecutionEventBus {
  private readonly sns: SNSClient;
  private readonly snsTopicArn: string;
  private readonly taskId: string;
  private readonly instanceId: string;

  constructor(
    taskId: string,
    instanceId: string,
    sns: SNSClient,
    snsTopicArn: string
  ) {
    super();
    this.taskId = taskId;
    this.instanceId = instanceId;
    this.sns = sns;
    this.snsTopicArn = snsTopicArn;
  }

  /**
   * Delivers the event locally (synchronous) and asynchronously publishes to
   * SNS for cross-instance fan-out.
   */
  override publish(event: AgentExecutionEvent): void {
    // 1. Immediate local delivery — SSE clients on this instance get it now.
    super.publish(event);
    // 2. Fire-and-forget to SNS for other instances.
    this.publishToSns({ taskId: this.taskId, instanceId: this.instanceId, type: 'event', event });
  }

  /**
   * Signals local listeners that execution has finished, and publishes the
   * finished signal to SNS so remote instances can close their SSE streams.
   */
  override finished(): void {
    super.finished();
    this.publishToSns({ taskId: this.taskId, instanceId: this.instanceId, type: 'finished' });
  }

  /**
   * Delivers an event locally WITHOUT publishing to SNS.
   * Called by the SQS poller when relaying a remote event to local listeners.
   * This breaks the publish → SNS → SQS → publishLocal cycle.
   */
  publishLocal(event: AgentExecutionEvent): void {
    super.publish(event);
  }

  /**
   * Signals local listeners that execution has finished WITHOUT publishing to
   * SNS.  Called by the SQS poller on receipt of a remote 'finished' message.
   */
  finishedLocal(): void {
    super.finished();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────────

  private publishToSns(msg: SnsEventMessage): void {
    // Intentionally not awaited — publish() must remain synchronous.
    this.sns
      .send(
        new PublishCommand({
          TopicArn: this.snsTopicArn,
          Message: JSON.stringify(msg),
          // MessageAttributes allow SNS subscription filter policies per instance.
          MessageAttributes: {
            taskId: { DataType: 'String', StringValue: msg.taskId },
            instanceId: { DataType: 'String', StringValue: msg.instanceId },
            type: { DataType: 'String', StringValue: msg.type },
          },
        })
      )
      .catch((err) => {
        // Log and swallow — a missed remote delivery is preferable to crashing
        // the executor.  Operators should configure SNS DLQs for durability.
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'sns.publish.failed',
            taskId: this.taskId,
            errorMessage: err instanceof Error ? err.message : String(err),
          })
        );
      });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// SqsEventPoller
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Polls this instance's SQS queue and delivers incoming SNS fan-out messages
 * to the appropriate local DistributedExecutionEventBus.
 *
 * Lifecycle:
 *   - `start()` begins the polling loop (idempotent).
 *   - `stop()` signals the loop to terminate after the current batch.
 */
export class SqsEventPoller {
  private readonly sqs: SQSClient;
  private readonly queueUrl: string;
  private readonly instanceId: string;
  private readonly waitTimeSeconds: number;
  private readonly maxMessages: number;
  private readonly pollIntervalMs: number;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  /** Callback invoked for each decoded SNS message. */
  private readonly onMessage: (msg: SnsEventMessage) => void;

  constructor(
    sqs: SQSClient,
    queueUrl: string,
    instanceId: string,
    onMessage: (msg: SnsEventMessage) => void,
    opts: { waitTimeSeconds?: number; maxMessages?: number; pollIntervalMs?: number } = {}
  ) {
    this.sqs = sqs;
    this.queueUrl = queueUrl;
    this.instanceId = instanceId;
    this.onMessage = onMessage;
    this.waitTimeSeconds = opts.waitTimeSeconds ?? 5;
    this.maxMessages = opts.maxMessages ?? 10;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
  }

  /** Starts the SQS polling loop (idempotent). */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  /** Stops the polling loop. In-flight receives complete normally. */
  stop(): void {
    this.running = false;
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        await this.receiveAndProcess();
      } catch (err) {
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'sqs.poll.error',
            queueUrl: this.queueUrl,
            errorMessage: err instanceof Error ? err.message : String(err),
          })
        );
      }

      if (this.running) {
        // Brief pause between polls to avoid tight loops on empty queues.
        await new Promise<void>((resolve) => {
          this.pollTimer = setTimeout(resolve, this.pollIntervalMs);
        });
      }
    }
  }

  private async receiveAndProcess(): Promise<void> {
    const response = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: this.maxMessages,
        WaitTimeSeconds: this.waitTimeSeconds, // Long polling reduces empty receives.
        AttributeNames: ['All'],
      })
    );

    const messages = response.Messages ?? [];
    await Promise.all(messages.map((m) => this.processMessage(m)));
  }

  private async processMessage(sqsMsg: SQSMessage): Promise<void> {
    if (!sqsMsg.Body || !sqsMsg.ReceiptHandle) return;

    try {
      // SNS wraps the original message in an envelope when delivering to SQS.
      const snsEnvelope = JSON.parse(sqsMsg.Body) as { Message?: string };
      const rawMessage = snsEnvelope.Message ?? sqsMsg.Body;
      const msg = JSON.parse(rawMessage) as SnsEventMessage;

      // Skip messages originating from this instance to avoid double-delivery.
      if (msg.instanceId === this.instanceId) {
        await this.deleteMessage(sqsMsg.ReceiptHandle);
        return;
      }

      this.onMessage(msg);
      await this.deleteMessage(sqsMsg.ReceiptHandle);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'sqs.message.parse.error',
          sqsMsgId: sqsMsg.MessageId,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      );
      // Do NOT delete on parse error → message becomes visible again after
      // visibility timeout and can be moved to a DLQ after maxReceiveCount.
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      })
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// SnsEventBusManager
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for DefaultExecutionEventBusManager in multi-node
 * deployments.
 *
 * Responsibilities:
 *  1. Creates DistributedExecutionEventBus instances per taskId.
 *  2. Starts an SqsEventPoller that delivers cross-instance events to local buses.
 *  3. Cleans up local buses and stops polling on shutdown.
 *
 * Usage:
 * ```typescript
 * const manager = new SnsEventBusManager({
 *   snsTopicArn: process.env.SNS_TOPIC_ARN!,
 *   sqsQueueUrl: process.env.SQS_QUEUE_URL!, // this instance's queue
 * });
 * manager.start();
 *
 * // Plug in wherever DefaultExecutionEventBusManager is used:
 * const handler = new DefaultRequestHandler(agentCard, taskStore, executor, manager);
 * ```
 */
export class SnsEventBusManager implements ExecutionEventBusManager {
  /**
   * Unique identifier for this server instance; injected into SNS messages.
   *
   * Set from `config.instanceId` when provided (e.g. from
   * `QueueLifecycleManager.provisionResult.instanceId`), otherwise a fresh
   * UUID is generated.  Must match the ID embedded in the queue name to
   * ensure the SqsEventPoller correctly discards self-originated messages.
   */
  readonly instanceId: string;

  private readonly sns: SNSClient;
  private readonly snsTopicArn: string;
  private readonly poller: SqsEventPoller;
  private readonly buses: Map<string, DistributedExecutionEventBus> = new Map();

  constructor(config: SnsEventBusConfig) {
    // Accept an externally supplied instanceId (from QueueLifecycleManager) so
    // both components stay in sync.  Fallback to a fresh UUID for standalone use.
    this.instanceId = config.instanceId ?? randomUUID();
    this.sns = config.snsClient ?? new SNSClient({});
    this.snsTopicArn = config.snsTopicArn;

    const sqs = config.sqsClient ?? new SQSClient({});

    this.poller = new SqsEventPoller(
      sqs,
      config.sqsQueueUrl,
      this.instanceId,
      (msg) => this.handleIncomingMessage(msg),
      {
        pollIntervalMs: config.pollIntervalMs ?? 1000,
        waitTimeSeconds: config.waitTimeSeconds ?? 5,
        maxMessages: config.maxMessages ?? 10,
      }
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ExecutionEventBusManager interface
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Returns the existing bus for the taskId, or creates a new one if absent.
   *
   * This is the hook point where Instance B creates a local bus BEFORE any
   * events arrive — the SSE handler calls this as soon as the client connects,
   * so the poller can deliver events into it as they arrive from SQS.
   */
  createOrGetByTaskId(taskId: string): ExecutionEventBus {
    if (!this.buses.has(taskId)) {
      this.buses.set(
        taskId,
        new DistributedExecutionEventBus(taskId, this.instanceId, this.sns, this.snsTopicArn)
      );
    }
    return this.buses.get(taskId)!;
  }

  /**
   * Returns the existing bus for the taskId, or undefined if absent.
   */
  getByTaskId(taskId: string): ExecutionEventBus | undefined {
    return this.buses.get(taskId);
  }

  /**
   * Removes the bus for the taskId and clears its listeners.
   */
  cleanupByTaskId(taskId: string): void {
    const bus = this.buses.get(taskId);
    if (bus) {
      bus.removeAllListeners();
    }
    this.buses.delete(taskId);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Starts the SQS polling loop.  Must be called once after construction.
   * Idempotent.
   */
  start(): void {
    this.poller.start();
  }

  /**
   * Stops the SQS polling loop and removes all listeners from all buses.
   * Call this on process SIGTERM / SIGINT.
   */
  stop(): void {
    this.poller.stop();
    for (const [taskId] of this.buses) {
      this.cleanupByTaskId(taskId);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Handles a decoded SNS message received via SQS.
   * Finds (or creates) the local bus for the taskId and delivers the event.
   *
   * Note: We use `createOrGetByTaskId` here so that even if an SSE client
   * connected *before* the task's first event arrived, the bus already exists
   * and its listeners will receive this delivery.
   */
  private handleIncomingMessage(msg: SnsEventMessage): void {
    const bus = this.createOrGetByTaskId(msg.taskId) as DistributedExecutionEventBus;

    if (msg.type === 'finished') {
      bus.finishedLocal();
      return;
    }

    if (msg.event !== undefined) {
      bus.publishLocal(msg.event);
    }
  }
}

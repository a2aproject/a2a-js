/**
 * Per-instance SQS queue lifecycle manager for ECS auto-scaling deployments.
 *
 * Problem
 * ───────
 * In an ECS Fargate service the number of running tasks is determined by the
 * auto-scaler — you cannot know it at infrastructure-definition time.
 * Pre-provisioning a fixed set of SQS queues and injecting a `SQS_QUEUE_URL`
 * environment variable into every task is therefore operationally fragile:
 *
 *   • Scale-out:  new tasks have no queue.
 *   • Scale-in:   queues from terminated tasks remain subscribed to SNS,
 *                 consuming throughput and requiring manual cleanup.
 *   • Rolling update: the new task can't start receiving SNS messages until
 *                 its queue exists and is subscribed.
 *
 * Solution
 * ────────
 * Each task instance creates its own SQS queue on startup and destroys it on
 * shutdown.  The queue name encodes the instance's unique ID so it is
 * guaranteed to be unique across the entire fleet.
 *
 *   Instance boot
 *      │
 *      ▼
 *   QueueLifecycleManager.provision()
 *      ├─ CreateQueue  → unique name  "{prefix}-{instanceId}"
 *      ├─ GetQueueAttributes → ARN
 *      ├─ SetQueueAttributes → SNS→SQS allow policy
 *      └─ SNS.Subscribe(protocol=sqs, endpoint=queueArn)
 *             │
 *             ▼
 *         SnsEventBusManager(instanceId, queueUrl)  ← start polling
 *             │
 *             ▼
 *         DefaultRequestHandler  ← ready to accept requests
 *
 *   Graceful shutdown (SIGTERM)
 *      │
 *      ▼
 *   SnsEventBusManager.stop()      ← drain in-flight SQS messages
 *   QueueLifecycleManager.teardown()
 *      ├─ SNS.Unsubscribe(subscriptionArn)
 *      └─ SQS.DeleteQueue(queueUrl)
 *
 * Crash / OOM / SIGKILL safety
 * ─────────────────────────────
 * If the process exits without calling teardown():
 *   • The SQS queue remains but its messages expire after
 *     `messageRetentionPeriod` seconds (default 300 s = 5 min).
 *   • The SNS subscription remains active.  Subsequent deliveries fail
 *     silently once AWS detects the queue is unreachable (usually within
 *     minutes) and the subscription is auto-disabled.
 *   • Operators can schedule a periodic Lambda to sweep stale queues by
 *     tag (`ManagedBy = a2a-server`, `LastHeartbeat < now - threshold`).
 *
 * Design decisions
 * ─────────────────
 * Decision: Queue name = `{prefix}-{instanceId}` (truncated to 80 chars).
 * Rationale: SQS names must be globally unique within an account/region and
 *   ≤80 characters (alphanumeric + hyphens + underscores).  UUID-based names
 *   provide the necessary uniqueness without coordination.
 * Trade-offs: Queue name is not human-readable but is derivable from logs.
 * Compliance impact: Tags (`ManagedBy`, `InstanceId`, `ServiceName`) enable
 *   cost-allocation and automated garbage collection.
 *
 * Decision: MessageRetentionPeriod defaults to 300 s.
 * Rationale: These queues carry only ephemeral SSE fan-out messages.  A 5-
 *   minute window is sufficient for normal rolling deployments.  Longer
 *   retention increases the cost of abandoned queues.
 * Trade-offs: Tasks that take > 5 min to re-subscribe after a crash may miss
 *   events.  Increase `messageRetentionPeriod` if your tasks are long-lived.
 * Compliance impact: Shorter retention limits PII exposure in transit.
 *
 * Decision: SNS subscription uses RawMessageDelivery=false (SNS envelope).
 * Rationale: The SqsEventPoller uses the SNS `Message` wrapper to distinguish
 *   SNS deliveries from messages sent directly to SQS in tests.  The envelope
 *   also carries `MessageAttributes` for future SNS filter-policy support.
 * Trade-offs: Slightly larger message payload.
 * Compliance impact: None.
 */

import {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import {
  SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
} from '@aws-sdk/client-sns';
import { randomUUID } from 'node:crypto';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/** Configuration for QueueLifecycleManager. */
export interface QueueLifecycleConfig {
  /** ARN of the SNS topic to subscribe the per-instance queue to. */
  snsTopicArn: string;

  /**
   * Prefix prepended to the generated queue name.
   * Must be alphanumeric + hyphens + underscores.
   * The final name is `{prefix}-{instanceId}` truncated to 80 characters.
   * Default: `'a2a'`.
   */
  queueNamePrefix?: string;

  /**
   * How long (seconds) SQS retains undelivered messages.
   * This is the crash-safety window: a queue abandoned by a killed instance
   * will stop accumulating stale messages after this period.
   * Default: 300 (5 minutes).
   */
  messageRetentionPeriod?: number;

  /**
   * SQS visibility timeout in seconds.
   * Set this to at least as long as your worst-case message processing time.
   * Default: 30.
   */
  visibilityTimeout?: number;

  /**
   * ARN of an existing dead-letter queue for messages that exceed
   * `maxReceiveCount`.  Optional — set this for production deployments.
   */
  dlqArn?: string;

  /**
   * Number of receive attempts before a message is moved to the DLQ.
   * Only used when `dlqArn` is set.  Default: 5.
   */
  maxReceiveCount?: number;

  /**
   * Optional human-readable service name added as a `ServiceName` tag to the
   * queue.  Useful for cost-allocation and automated cleanup.
   */
  serviceName?: string;

  /** Pre-configured SQS client.  Defaults to standard credential chain. */
  sqsClient: SQSClient;

  /** Pre-configured SNS client.  Defaults to standard credential chain. */
  snsClient: SNSClient;
}

/**
 * Result returned by `QueueLifecycleManager.provision()`.
 * Pass `queueUrl` and `instanceId` to `SnsEventBusManager`.
 */
export interface QueueProvisionResult {
  /** URL of the created SQS queue.  Pass as `sqsQueueUrl` to SnsEventBusManager. */
  queueUrl: string;
  /** ARN of the created SQS queue. */
  queueArn: string;
  /** ARN of the SNS subscription.  Stored internally for teardown. */
  subscriptionArn: string;
  /**
   * Unique identifier for this server instance.
   * Pass as `instanceId` to SnsEventBusManager so both components agree on
   * which messages originated locally (deduplication).
   */
  instanceId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// QueueLifecycleManager
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Creates and destroys the per-instance SQS queue + SNS subscription that
 * back `SnsEventBusManager`.
 *
 * Intended call sequence:
 * ```typescript
 * const lifecycle = new QueueLifecycleManager({ snsTopicArn, sqsClient, snsClient });
 *
 * // --- before DefaultRequestHandler is constructed ---
 * const { queueUrl, instanceId } = await lifecycle.provision();
 *
 * const eventBusManager = new SnsEventBusManager({
 *   snsTopicArn,
 *   sqsQueueUrl: queueUrl,
 *   instanceId,          // ← same ID for dedup
 *   sqsClient,
 *   snsClient,
 * });
 * eventBusManager.start();
 *
 * // --- on SIGTERM ---
 * eventBusManager.stop();
 * await lifecycle.teardown();
 * ```
 */
export class QueueLifecycleManager {
  /**
   * Unique identifier for this server instance.
   * Generated once at construction and stable for the lifetime of the process.
   */
  readonly instanceId: string = randomUUID();

  private readonly snsTopicArn: string;
  private readonly prefix: string;
  private readonly retentionPeriod: number;
  private readonly visibilityTimeout: number;
  private readonly dlqArn: string | undefined;
  private readonly maxReceiveCount: number;
  private readonly serviceName: string | undefined;
  private readonly sqs: SQSClient;
  private readonly sns: SNSClient;

  /** Cached result after a successful provision(). Cleared by teardown(). */
  private result: QueueProvisionResult | null = null;

  constructor(config: QueueLifecycleConfig) {
    this.snsTopicArn = config.snsTopicArn;
    this.prefix = config.queueNamePrefix ?? 'a2a';
    this.retentionPeriod = config.messageRetentionPeriod ?? 300;
    this.visibilityTimeout = config.visibilityTimeout ?? 30;
    this.dlqArn = config.dlqArn;
    this.maxReceiveCount = config.maxReceiveCount ?? 5;
    this.serviceName = config.serviceName;
    this.sqs = config.sqsClient;
    this.sns = config.snsClient;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Creates the SQS queue, applies the SNS→SQS allow policy, and subscribes
   * the queue to the SNS topic.
   *
   * **Idempotent** — calling `provision()` a second time returns the cached
   * result; no additional AWS calls are made.
   *
   * **Rollback** — if the SNS subscription step fails the queue is deleted
   * before the error is re-thrown, leaving no orphaned resources.
   *
   * @returns Provision result including `queueUrl` and `instanceId`.
   * @throws {Error} If any AWS call fails (after rollback where applicable).
   */
  async provision(): Promise<QueueProvisionResult> {
    if (this.result !== null) return this.result;

    // ── Step 1: Create SQS queue ─────────────────────────────────────────────
    const tags: Record<string, string> = {
      ManagedBy: 'a2a-server',
      InstanceId: this.instanceId,
    };
    if (this.serviceName) {
      tags['ServiceName'] = this.serviceName;
    }

    const redrivePolicy =
      this.dlqArn !== undefined
        ? {
            RedrivePolicy: JSON.stringify({
              deadLetterTargetArn: this.dlqArn,
              maxReceiveCount: String(this.maxReceiveCount),
            }),
          }
        : {};

    const createResp = await this.sqs.send(
      new CreateQueueCommand({
        QueueName: this.queueName,
        Attributes: {
          MessageRetentionPeriod: String(this.retentionPeriod),
          VisibilityTimeout: String(this.visibilityTimeout),
          ...redrivePolicy,
        },
        tags,
      })
    );

    const queueUrl = createResp.QueueUrl!;

    // ── Step 2: Retrieve the queue ARN ───────────────────────────────────────
    const attrResp = await this.sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['QueueArn'],
      })
    );

    const queueArn = attrResp.Attributes!['QueueArn']!;

    // ── Step 3: Set queue policy allowing SNS to send messages ───────────────
    // This resource-based policy is the AWS-recommended way to authorise SNS
    // deliveries; it does not require any IAM changes on the SNS topic side.
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowSNSPublish',
          Effect: 'Allow',
          Principal: { Service: 'sns.amazonaws.com' },
          Action: 'sqs:SendMessage',
          Resource: queueArn,
          Condition: {
            ArnEquals: { 'aws:SourceArn': this.snsTopicArn },
          },
        },
      ],
    });

    await this.sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: { Policy: policy },
      })
    );

    // ── Step 4: Subscribe to the SNS topic (with rollback on failure) ────────
    let subscriptionArn: string;
    try {
      const subResp = await this.sns.send(
        new SubscribeCommand({
          TopicArn: this.snsTopicArn,
          Protocol: 'sqs',
          Endpoint: queueArn,
          Attributes: {
            // Keep the SNS envelope (Type, MessageId, etc.) so the
            // SqsEventPoller can unwrap it and read instanceId for dedup.
            RawMessageDelivery: 'false',
          },
        })
      );
      subscriptionArn = subResp.SubscriptionArn!;
    } catch (subscribeErr) {
      // Rollback: remove the queue we just created to avoid orphaned resources.
      await this.sqs
        .send(new DeleteQueueCommand({ QueueUrl: queueUrl }))
        .catch((deleteErr) => {
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'queue_lifecycle.rollback_delete_failed',
              instanceId: this.instanceId,
              queueUrl,
              error: String(deleteErr),
            })
          );
        });
      throw subscribeErr;
    }

    this.result = { queueUrl, queueArn, subscriptionArn, instanceId: this.instanceId };

    console.info(
      JSON.stringify({
        level: 'info',
        msg: 'queue_lifecycle.provisioned',
        instanceId: this.instanceId,
        queueName: this.queueName,
        queueArn,
        subscriptionArn,
      })
    );

    return this.result;
  }

  /**
   * Unsubscribes from the SNS topic and deletes the SQS queue.
   *
   * **Idempotent** — no-op if `provision()` was never called or `teardown()`
   * has already been called.
   *
   * **Best-effort unsubscribe** — if the SNS Unsubscribe call fails the error
   * is logged and teardown continues to delete the queue.  The SNS subscription
   * will be automatically disabled by AWS once it detects the queue is gone.
   *
   * @throws {Error} If the SQS DeleteQueue call fails.
   */
  async teardown(): Promise<void> {
    if (this.result === null) return;

    const { queueUrl, subscriptionArn } = this.result;

    // ── Step 1: Unsubscribe from SNS (best-effort) ───────────────────────────
    try {
      await this.sns.send(new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }));
    } catch (err) {
      // Log and continue — the queue deletion below renders the subscription
      // unreachable so it will be auto-disabled by SNS regardless.
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'queue_lifecycle.unsubscribe_failed',
          instanceId: this.instanceId,
          subscriptionArn,
          error: String(err),
        })
      );
    }

    // ── Step 2: Delete the SQS queue ─────────────────────────────────────────
    await this.sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));

    console.info(
      JSON.stringify({
        level: 'info',
        msg: 'queue_lifecycle.torn_down',
        instanceId: this.instanceId,
        queueUrl,
      })
    );

    this.result = null;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Accessors
  // ────────────────────────────────────────────────────────────────────────────

  /** `true` once `provision()` has completed successfully. */
  get isProvisioned(): boolean {
    return this.result !== null;
  }

  /** The cached provision result, or `null` if not yet provisioned. */
  get provisionResult(): QueueProvisionResult | null {
    return this.result;
  }

  /**
   * The SQS queue name that will be (or was) created.
   * Format: `{prefix}-{instanceId}`, truncated to 80 characters.
   */
  get queueName(): string {
    // SQS queue names: max 80 chars, alphanumeric + hyphens + underscores.
    return `${this.prefix}-${this.instanceId}`.slice(0, 80);
  }
}

/**
 * @a2a-js/sdk/server/distributed
 *
 * Drop-in replacements for the default in-process components when deploying
 * the A2A server across multiple instances (ECS Fargate, Kubernetes, etc.).
 *
 * This sub-path is intentionally kept separate from `@a2a-js/sdk/server` so
 * that single-instance deployments incur zero AWS SDK dependency weight.
 * Install the peer dependencies only when you use this sub-path:
 *
 * ```bash
 * npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb \
 *             @aws-sdk/client-sns @aws-sdk/client-sqs
 * ```
 *
 * Typical wiring:
 *
 * ```typescript
 * import {
 *   DynamoDBTaskStore,
 *   QueueLifecycleManager,
 *   SnsEventBusManager,
 * } from '@a2a-js/sdk/server/distributed';
 *
 * const lifecycle = new QueueLifecycleManager({ snsTopicArn, sqsClient, snsClient });
 * const { queueUrl, instanceId } = await lifecycle.provision();
 *
 * const eventBusManager = new SnsEventBusManager({
 *   snsTopicArn, sqsQueueUrl: queueUrl, instanceId, snsClient, sqsClient,
 * });
 * eventBusManager.start();
 *
 * const requestHandler = new DefaultRequestHandler(
 *   agentCard,
 *   new DynamoDBTaskStore({ client: dynamoDocClient, tableName }),
 *   executor,
 *   eventBusManager,
 * );
 * ```
 *
 * @module @a2a-js/sdk/server/distributed
 */

// ── Persistent task store (DynamoDB) ─────────────────────────────────────────

export { DynamoDBTaskStore } from '../store/dynamo_task_store.js';
export type { DynamoTaskStoreConfig } from '../store/dynamo_task_store.js';

// Typed error hierarchy — callers can catch by class and inspect `.retryable`
// to decide whether to surface the error or transparently retry upstream.
export {
  TaskStoreError,
  TaskNotFoundError,
  TaskConflictError,
  StoreUnavailableError,
} from '../store/errors.js';

// ── Per-instance queue lifecycle (SQS + SNS subscription) ────────────────────

export { QueueLifecycleManager } from '../events/queue_lifecycle_manager.js';
export type {
  QueueLifecycleConfig,
  QueueProvisionResult,
} from '../events/queue_lifecycle_manager.js';

// ── Distributed event bus manager (SNS fan-out → SQS per-instance delivery) ──

export {
  SnsEventBusManager,
  DistributedExecutionEventBus,
  SqsEventPoller,
} from '../events/sns_sqs_event_bus_manager.js';
export type { SnsEventBusConfig } from '../events/sns_sqs_event_bus_manager.js';

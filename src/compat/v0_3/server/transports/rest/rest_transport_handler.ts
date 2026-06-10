/**
 * v0.3 HTTP+JSON (REST) Transport Handler.
 *
 * Mirrors {@link import('../../../../../server/transports/rest/rest_transport_handler.js').RestTransportHandler}
 * (the v1.0 handler) but accepts v0.3-shaped JSON payloads and returns
 * v0.3-shaped JSON results. Inbound params are translated to v1.0 proto
 * values via the `toCore*` helpers in `../../../translate/requests.js`,
 * dispatched to the v1.0 {@link A2ARequestHandler}, and translated back
 * to v0.3 JSON via the `toCompat*` helpers before being returned to the
 * Express layer.
 *
 * Designed to share an `A2ARequestHandler` instance with the v1.0
 * handler so a single agent implementation can serve both protocol
 * versions side-by-side.
 */

import type { ServerCallContext } from '../../../../../server/context.js';
import type { A2ARequestHandler } from '../../../../../server/request_handler/a2a_request_handler.js';
import {
  HTTP_STATUS,
  mapErrorToStatus,
} from '../../../../../server/transports/rest/rest_transport_handler.js';
import type {
  AgentCard as V1AgentCard,
  Message as V1Message,
  StreamResponse as V1StreamResponse,
  Task as V1Task,
} from '../../../../../types/pb/a2a.js';
import { toCompatAgentCard } from '../../../translate/agent_card.js';
import { type LegacyRestErrorBody, toCompatErrorBody } from '../../../translate/errors.js';
import { toCompatMessage } from '../../../translate/messages.js';
import {
  toCompatTaskPushNotificationConfig,
  toCoreTaskPushNotificationConfig,
} from '../../../translate/push_notifications.js';
import { toCompatStreamResponse, toCoreSendMessageRequest } from '../../../translate/requests.js';
import { toCompatTask } from '../../../translate/tasks.js';
import type * as legacy from '../../../types/types.js';
import { A2AError as LegacyA2AError } from '../../error.js';

// Re-export the shared HTTP status / error mapping helpers from the v1.0
// transport handler. Numeric A2A error codes and their HTTP semantics
// are identical between v0.3 and v1.0 for every code that exists in
// both, so no parallel implementation is needed.
export { HTTP_STATUS, mapErrorToStatus };

// ============================================================================
// HTTP Error Conversion (v0.3 wire shape)
// ============================================================================

// Re-export the v0.3 REST error body type and converter from the
// translate unit so existing consumers (including the public
// `LegacyRestErrorBody` / `toLegacyHTTPError` exports) keep working.
// The actual v1.0 → v0.3 demotion logic — pass `LegacyA2AError`
// through, map known v1.0 SDK error classes to their numeric codes,
// strip the enriched `details[]`/`ErrorInfo` payload — lives in
// `../../../translate/errors.ts` and is shared with the JSON-RPC
// handler.
export type { LegacyRestErrorBody };

/**
 * Converts any error to a v0.3-shaped HTTP error body.
 *
 * Thin wrapper around {@link toCompatErrorBody} kept on this module
 * for backward compatibility with existing call sites (including
 * {@link LegacyRestTransportHandler.mapToLegacyHTTPError} and the
 * Express layer in `../../express/rest_handler.ts`).
 *
 * The cast is safe because the underlying converter returns a body
 * that is structurally identical to {@link LegacyRestErrorBody}.
 */
export function toLegacyHTTPError(error: unknown): LegacyRestErrorBody {
  return toCompatErrorBody(error) as LegacyRestErrorBody;
}

// ============================================================================
// REST Transport Handler Class
// ============================================================================

/**
 * Handles v0.3 REST transport, routing requests to a v1.0
 * {@link A2ARequestHandler}.
 *
 * Each public method:
 *   1. Accepts v0.3-shaped JSON params (already parsed from `req.body`,
 *      `req.params`, or `req.query` by the Express layer).
 *   2. Translates the params to v1.0 proto via the matching `toCore*`
 *      helper.
 *   3. Awaits the v1.0 request handler.
 *   4. Translates the v1.0 result back to v0.3 JSON via the matching
 *      `toCompat*` helper.
 *
 * Streaming methods return an `AsyncGenerator` of v0.3-shaped
 * `SendStreamingMessageSuccessResponse.result` payloads
 * (`Task | Message | TaskStatusUpdateEvent | TaskArtifactUpdateEvent`).
 */
export class LegacyRestTransportHandler {
  private requestHandler: A2ARequestHandler;

  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
  }

  // ==========================================================================
  // Public API Methods
  // ==========================================================================

  /**
   * Returns the v1.0 agent card (used for capability checks).
   */
  async getAgentCard(): Promise<V1AgentCard> {
    return this.requestHandler.getAgentCard();
  }

  /**
   * Returns the authenticated extended agent card translated to v0.3 JSON.
   */
  async getAuthenticatedExtendedAgentCard(context: ServerCallContext): Promise<legacy.AgentCard> {
    const core = await this.requestHandler.getAuthenticatedExtendedAgentCard(
      { tenant: context.tenant ?? '' },
      context
    );
    return toCompatAgentCard(core);
  }

  /**
   * Validates that the v0.3 `MessageSendParams` is well-formed.
   */
  private validateMessageSendParams(params: legacy.MessageSendParams): void {
    if (!params.message) {
      throw LegacyA2AError.invalidParams('message is required');
    }
    if (!params.message.messageId) {
      throw LegacyA2AError.invalidParams('message.messageId is required');
    }
  }

  /**
   * Sends a message to the agent (synchronous).
   * Returns either a v0.3 `Task` or `Message` envelope.
   */
  async sendMessage(
    params: legacy.MessageSendParams,
    context: ServerCallContext
  ): Promise<legacy.Task | legacy.Message> {
    this.validateMessageSendParams(params);
    const coreReq = toCoreSendMessageRequest(
      buildLegacySendRequest(params, 'message/send'),
      context.tenant ?? ''
    );
    const result = await this.requestHandler.sendMessage(coreReq, context);
    return 'messageId' in result
      ? toCompatMessage(result as V1Message)
      : toCompatTask(result as V1Task);
  }

  /**
   * Sends a message to the agent with a streaming response.
   * Yields v0.3-shaped stream event payloads (the `.result` portion of
   * the v0.3 `SendStreamingMessageSuccessResponse`).
   *
   * @throws {LegacyA2AError} `unsupportedOperation` (-32004) if the
   *   agent does not advertise streaming.
   */
  async sendMessageStream(
    params: legacy.MessageSendParams,
    context: ServerCallContext
  ): Promise<
    AsyncGenerator<legacy.SendStreamingMessageSuccessResponse['result'], void, undefined>
  > {
    await this.requireCapability('streaming');
    this.validateMessageSendParams(params);
    const coreReq = toCoreSendMessageRequest(
      buildLegacySendRequest(params, 'message/stream'),
      context.tenant ?? ''
    );
    const stream = this.requestHandler.sendMessageStream(coreReq, context);
    return LegacyRestTransportHandler.translateStream(stream);
  }

  /**
   * Fetches a task by id, translated to v0.3 JSON.
   * Accepts optional `historyLength` (parsed/validated locally).
   *
   * `historyLength` is deliberately left absent on the params object
   * when the caller did not supply it: per §3.2.4, `undefined` means
   * "no client limit, return full history". Coercing the default to
   * `0` here would silently change the semantics to "return no
   * history".
   */
  async getTask(
    taskId: string,
    context: ServerCallContext,
    historyLength?: unknown
  ): Promise<legacy.Task> {
    const params: Parameters<A2ARequestHandler['getTask']>[0] = {
      id: taskId,
      tenant: context.tenant ?? '',
    };
    if (historyLength !== undefined) {
      params.historyLength = this.parseHistoryLength(historyLength);
    }
    const core = await this.requestHandler.getTask(params, context);
    return toCompatTask(core);
  }

  /**
   * Cancels a task, returning the updated v0.3 `Task` envelope.
   */
  async cancelTask(taskId: string, context: ServerCallContext): Promise<legacy.Task> {
    const core = await this.requestHandler.cancelTask(
      { id: taskId, tenant: context.tenant ?? '', metadata: {} },
      context
    );
    return toCompatTask(core);
  }

  /**
   * Resubscribes to a task's update stream.
   * Yields v0.3-shaped stream event payloads.
   *
   * @throws {LegacyA2AError} `unsupportedOperation` (-32004) if the
   *   agent does not advertise streaming.
   */
  async resubscribe(
    taskId: string,
    context: ServerCallContext
  ): Promise<
    AsyncGenerator<legacy.SendStreamingMessageSuccessResponse['result'], void, undefined>
  > {
    await this.requireCapability('streaming');
    const stream = this.requestHandler.resubscribe(
      { id: taskId, tenant: context.tenant ?? '' },
      context
    );
    return LegacyRestTransportHandler.translateStream(stream);
  }

  /**
   * Creates a push notification configuration (v0.3 calls this "set").
   *
   * @throws {LegacyA2AError} `pushNotificationNotSupported` (-32003) if
   *   the agent does not advertise push notifications.
   */
  async setTaskPushNotificationConfig(
    config: legacy.TaskPushNotificationConfig,
    context: ServerCallContext
  ): Promise<legacy.TaskPushNotificationConfig> {
    await this.requireCapability('pushNotifications');
    if (!config.taskId) {
      throw LegacyA2AError.invalidParams('taskId is required');
    }
    if (!config.pushNotificationConfig) {
      throw LegacyA2AError.invalidParams('pushNotificationConfig is required');
    }
    const core = toCoreTaskPushNotificationConfig(config, context.tenant ?? '');
    const result = await this.requestHandler.createTaskPushNotificationConfig(core, context);
    return toCompatTaskPushNotificationConfig(result);
  }

  /**
   * Lists all push notification configurations for a task.
   * Returns a v0.3-shaped array of `TaskPushNotificationConfig`.
   */
  async listTaskPushNotificationConfigs(
    taskId: string,
    context: ServerCallContext
  ): Promise<legacy.TaskPushNotificationConfig[]> {
    const result = await this.requestHandler.listTaskPushNotificationConfigs(
      { taskId, pageSize: 0, pageToken: '', tenant: context.tenant ?? '' },
      context
    );
    return result.configs.map((cfg) => toCompatTaskPushNotificationConfig(cfg));
  }

  /**
   * Fetches a specific push notification configuration, translated to v0.3 JSON.
   */
  async getTaskPushNotificationConfig(
    taskId: string,
    configId: string,
    context: ServerCallContext
  ): Promise<legacy.TaskPushNotificationConfig> {
    const result = await this.requestHandler.getTaskPushNotificationConfig(
      { taskId, id: configId, tenant: context.tenant ?? '' },
      context
    );
    return toCompatTaskPushNotificationConfig(result);
  }

  /**
   * Deletes a push notification configuration.
   */
  async deleteTaskPushNotificationConfig(
    taskId: string,
    configId: string,
    context: ServerCallContext
  ): Promise<void> {
    await this.requestHandler.deleteTaskPushNotificationConfig(
      { taskId, id: configId, tenant: context.tenant ?? '' },
      context
    );
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Wraps a v1.0 stream into a v0.3 stream by translating each event via
   * `toCompatStreamResponse` and unwrapping the JSON-RPC envelope (REST
   * SSE events carry only the `.result` payload, not the JSON-RPC
   * wrapper).
   */
  private static async *translateStream(
    stream: AsyncGenerator<V1StreamResponse, void, undefined>
  ): AsyncGenerator<legacy.SendStreamingMessageSuccessResponse['result'], void, undefined> {
    for await (const event of stream) {
      const envelope = toCompatStreamResponse(event, null);
      yield envelope.result;
    }
  }

  /**
   * Static map of capability to error factory for missing capabilities.
   */
  private static readonly CAPABILITY_ERRORS: Record<
    'streaming' | 'pushNotifications',
    () => LegacyA2AError
  > = {
    streaming: () => LegacyA2AError.unsupportedOperation('Agent does not support streaming'),
    pushNotifications: () => LegacyA2AError.pushNotificationNotSupported(),
  };

  /**
   * Validates that the agent supports a required capability.
   *
   * @throws {LegacyA2AError} `unsupportedOperation` for streaming,
   *   `pushNotificationNotSupported` for push notifications.
   */
  private async requireCapability(capability: 'streaming' | 'pushNotifications'): Promise<void> {
    const agentCard = await this.getAgentCard();
    if (!agentCard.capabilities?.[capability]) {
      throw LegacyRestTransportHandler.CAPABILITY_ERRORS[capability]();
    }
  }

  /**
   * Parses and validates the `historyLength` query parameter.
   */
  private parseHistoryLength(value: unknown): number {
    if (value === undefined || value === null) {
      throw LegacyA2AError.invalidParams('historyLength is required');
    }
    const parsed = parseInt(String(value), 10);
    if (isNaN(parsed)) {
      throw LegacyA2AError.invalidParams('historyLength must be a valid integer');
    }
    if (parsed < 0) {
      throw LegacyA2AError.invalidParams('historyLength must be non-negative');
    }
    return parsed;
  }

  /**
   * Converts any error to a v0.3-shaped HTTP error body. Exposed
   * statically so the Express layer can reuse the same mapping logic
   * without holding a transport-handler instance. Mirrors
   * `LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError`.
   */
  public static mapToLegacyHTTPError(error: unknown): LegacyRestErrorBody {
    return toLegacyHTTPError(error);
  }
}

/**
 * Wraps a v0.3 `MessageSendParams` in a minimal v0.3 JSON-RPC request
 * envelope so it can be fed through `toCoreSendMessageRequest` (which
 * was originally written for the JSON-RPC path and expects the
 * `{ params: { … } }` wrapping).
 *
 * The `jsonrpc`, `id`, and `method` fields are placeholders: only
 * `params` is consumed by the translator, but they're required by the
 * envelope's TypeScript shape. The return type is the union
 * `SendMessageRequest | SendStreamingMessageRequest` because the
 * translator accepts either; the caller picks one via the `method`
 * argument purely to satisfy the discriminated-union envelope.
 */
function buildLegacySendRequest(
  params: legacy.MessageSendParams,
  method: 'message/send' | 'message/stream'
): legacy.SendMessageRequest | legacy.SendStreamingMessageRequest {
  return { jsonrpc: '2.0', id: 0, method, params };
}

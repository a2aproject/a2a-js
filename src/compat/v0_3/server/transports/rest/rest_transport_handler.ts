/**
 * v0.3 HTTP+JSON (REST) transport handler. Accepts v0.3-shaped JSON
 * payloads, translates to v1.0 proto, dispatches through
 * `A2ARequestHandler`, and translates the response back to v0.3 JSON.
 */

import type { ServerCallContext } from '../../../../../server/context.js';
import type { A2ARequestHandler } from '../../../../../server/request_handler/a2a_request_handler.js';
import {
  HTTP_STATUS,
  isJsonRpcError,
  restStatusFor as mapV1ErrorToStatus,
} from '../../../../../errors/index.js';
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
import type { A2AError as A2AErrorBase } from '../../../../../errors/index.js';

// Numeric A2A error codes and HTTP semantics are identical between v0.3
// and v1.0, so we reuse the v1.0 mapping helpers as-is.
export { HTTP_STATUS };

export type { LegacyRestErrorBody };

/** JSON-RPC error code -> HTTP status. */
const LEGACY_CODE_TO_HTTP_STATUS: Readonly<Record<number, number>> = {
  [-32700]: HTTP_STATUS.BAD_REQUEST, // Parse error
  [-32600]: HTTP_STATUS.BAD_REQUEST, // Invalid Request
  [-32601]: HTTP_STATUS.NOT_IMPLEMENTED, // Method not found
  [-32602]: HTTP_STATUS.BAD_REQUEST, // Invalid params
  [-32603]: HTTP_STATUS.INTERNAL_SERVER_ERROR, // Internal error
  [-32001]: HTTP_STATUS.NOT_FOUND, // Task not found
  [-32002]: HTTP_STATUS.BAD_REQUEST, // Task not cancelable
  [-32003]: HTTP_STATUS.BAD_REQUEST, // Push notification not supported
  [-32004]: HTTP_STATUS.BAD_REQUEST, // Unsupported operation
  [-32005]: HTTP_STATUS.BAD_REQUEST, // Content-Type not supported
  [-32006]: HTTP_STATUS.INTERNAL_SERVER_ERROR, // Invalid agent response
  [-32007]: HTTP_STATUS.BAD_REQUEST, // Extended card not configured
};

/**
 * Maps an error to its HTTP status code with v0.3-compat awareness.
 * `JsonRpc*Error` instances carry an `envelopeCode` that may differ
 * from the semantic default (e.g. `METHOD_NOT_FOUND` -> 501, not the
 * generic `UnsupportedOperationError` -> 400); those override the
 * class-based mapping. Everything else defers to the v1.0 mapper.
 */
export function mapErrorToStatus(error: unknown): number {
  if (isJsonRpcError(error)) {
    const override = LEGACY_CODE_TO_HTTP_STATUS[error.envelopeCode];
    if (override !== undefined) return override;
  }
  return mapV1ErrorToStatus(error);
}

/** Converts any error to a v0.3-shaped HTTP error body. */
export function toLegacyHTTPError(error: unknown): LegacyRestErrorBody {
  return toCompatErrorBody(error) as LegacyRestErrorBody;
}

/**
 * Routes v0.3 REST requests through a v1.0 `A2ARequestHandler`. Streaming
 * methods yield the bare v0.3 `.result` payloads (REST SSE has no
 * JSON-RPC wrapper).
 */
export class LegacyRestTransportHandler {
  private requestHandler: A2ARequestHandler;

  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
  }

  async getAgentCard(): Promise<V1AgentCard> {
    return this.requestHandler.getAgentCard();
  }

  async getAuthenticatedExtendedAgentCard(context: ServerCallContext): Promise<legacy.AgentCard> {
    const core = await this.requestHandler.getAuthenticatedExtendedAgentCard(
      { tenant: context.tenant ?? '' },
      context
    );
    return toCompatAgentCard(core);
  }

  private validateMessageSendParams(params: legacy.MessageSendParams): void {
    if (!params.message) {
      throw LegacyA2AError.invalidParams('message is required');
    }
    if (!params.message.messageId) {
      throw LegacyA2AError.invalidParams('message.messageId is required');
    }
  }

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

  /** Throws `unsupportedOperation` if the agent does not advertise streaming. */
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
   * Leave `historyLength` absent when the caller didn't supply it:
   * `undefined` means "no client limit, return full history". Coercing
   * to `0` would silently change the semantics to "return no history".
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

  async cancelTask(taskId: string, context: ServerCallContext): Promise<legacy.Task> {
    const core = await this.requestHandler.cancelTask(
      { id: taskId, tenant: context.tenant ?? '', metadata: {} },
      context
    );
    return toCompatTask(core);
  }

  /** Throws `unsupportedOperation` if the agent does not advertise streaming. */
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

  /** v0.3 calls this "set". Throws if push notifications are not supported. */
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

  /**
   * Translates each event via `toCompatStreamResponse` and unwraps the
   * JSON-RPC envelope — REST SSE carries only `.result`.
   */
  private static async *translateStream(
    stream: AsyncGenerator<V1StreamResponse, void, undefined>
  ): AsyncGenerator<legacy.SendStreamingMessageSuccessResponse['result'], void, undefined> {
    for await (const event of stream) {
      const envelope = toCompatStreamResponse(event, null);
      yield envelope.result;
    }
  }

  private static readonly CAPABILITY_ERRORS: Record<
    'streaming' | 'pushNotifications',
    () => A2AErrorBase
  > = {
    streaming: () => LegacyA2AError.unsupportedOperation('Agent does not support streaming'),
    pushNotifications: () => LegacyA2AError.pushNotificationNotSupported(),
  };

  private async requireCapability(capability: 'streaming' | 'pushNotifications'): Promise<void> {
    const agentCard = await this.getAgentCard();
    if (!agentCard.capabilities?.[capability]) {
      throw LegacyRestTransportHandler.CAPABILITY_ERRORS[capability]();
    }
  }

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

  /** Same as `toLegacyHTTPError`, exposed for the Express layer. */
  public static mapToLegacyHTTPError(error: unknown): LegacyRestErrorBody {
    return toLegacyHTTPError(error);
  }
}

/**
 * Wraps `MessageSendParams` in a minimal JSON-RPC envelope so it can be
 * fed through `toCoreSendMessageRequest` (which expects the `{ params }`
 * wrapping). Only `params` is consumed; the rest are placeholders.
 */
function buildLegacySendRequest(
  params: legacy.MessageSendParams,
  method: 'message/send' | 'message/stream'
): legacy.SendMessageRequest | legacy.SendStreamingMessageRequest {
  return { jsonrpc: '2.0', id: 0, method, params };
}

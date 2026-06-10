/**
 * v0.3 JSON-RPC transport handler.
 *
 * Mirrors `JsonRpcTransportHandler` (the v1.0 handler) but accepts v0.3
 * method names (e.g. `message/send`, `tasks/get`) and v0.3-shaped params.
 * Inbound params are translated to v1.0 proto values via the `toCore*`
 * helpers in `../../../translate/requests.js`, dispatched to the v1.0
 * `A2ARequestHandler`, and translated back to v0.3 JSON via the
 * `toCompat*` helpers before being wrapped in a JSON-RPC envelope.
 *
 * Designed to share a transport with the v1.0 handler: the Express
 * dispatcher selects between the two based on the method name (see
 * `isLegacyJsonRpcMethod`).
 */
import type { ServerCallContext } from '../../../../../server/context.js';
import type { A2ARequestHandler } from '../../../../../server/request_handler/a2a_request_handler.js';
import { toCompatAgentCard } from '../../../translate/agent_card.js';
import { toCompatErrorBody } from '../../../translate/errors.js';
import { toCompatMessage } from '../../../translate/messages.js';
import { toCompatTaskPushNotificationConfig } from '../../../translate/push_notifications.js';
import {
  toCompatListTaskPushNotificationConfigSuccessResponse,
  toCompatStreamResponse,
  toCoreCancelTaskRequest,
  toCoreCreateTaskPushNotificationConfigRequest,
  toCoreDeleteTaskPushNotificationConfigRequest,
  toCoreGetExtendedAgentCardRequest,
  toCoreGetTaskPushNotificationConfigRequest,
  toCoreGetTaskRequest,
  toCoreListTaskPushNotificationConfigsRequest,
  toCoreSendMessageRequest,
  toCoreSubscribeToTaskRequest,
} from '../../../translate/requests.js';
import { toCompatTask } from '../../../translate/tasks.js';
import type * as legacy from '../../../types/types.js';
import type { Message as V1Message, Task as V1Task } from '../../../../../types/pb/a2a.js';
import { A2AError } from '../../error.js';

/**
 * Minimal v0.3 JSON-RPC request envelope shape used by the handler.
 */
type LegacyA2ARequest = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: string | number | null;
};

/**
 * Minimal v0.3 JSON-RPC response envelope shape used by the handler.
 *
 * Both success and error responses use this shape; `result` and `error`
 * are mutually exclusive.
 */
type LegacyJSONRPCResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: legacy.JSONRPCError;
};

/**
 * Handles incoming v0.3 JSON-RPC requests by translating them to v1.0
 * proto, dispatching to a v1.0 `A2ARequestHandler`, and translating
 * responses back to the v0.3 JSON wire shape.
 */
export class LegacyJsonRpcTransportHandler {
  private requestHandler: A2ARequestHandler;

  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
  }

  /**
   * Handles an incoming v0.3 JSON-RPC request.
   *
   * For streaming methods (`message/stream`, `tasks/resubscribe`),
   * returns an `AsyncGenerator` of v0.3-shaped JSON-RPC envelopes.
   * For non-streaming methods, returns a single envelope (either a
   * success response or a v0.3 error response).
   */
  public async handle(
    requestBody: string | Record<string, unknown>,
    context: ServerCallContext
  ): Promise<LegacyJSONRPCResponse | AsyncGenerator<LegacyJSONRPCResponse, void, undefined>> {
    let rpcRequest: LegacyA2ARequest = { jsonrpc: '2.0', method: '' };
    try {
      if (typeof requestBody === 'string') {
        rpcRequest = JSON.parse(requestBody);
      } else if (typeof requestBody === 'object' && requestBody !== null) {
        rpcRequest = requestBody as LegacyA2ARequest;
      } else {
        throw A2AError.invalidRequest('Invalid request body type.');
      }

      if (!this.isRequestValid(rpcRequest)) {
        throw A2AError.invalidRequest('Invalid JSON-RPC Request.');
      }
    } catch (error) {
      const mappedError = LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError(
        error instanceof SyntaxError
          ? A2AError.invalidRequest(error.message || 'Failed to parse JSON request.')
          : error
      );
      return {
        jsonrpc: '2.0',
        id: rpcRequest.id ?? null,
        error: mappedError,
      };
    }

    const { method, id: requestId = null } = rpcRequest;
    try {
      // `agent/getAuthenticatedExtendedCard` carries no params; every other
      // legacy method requires a params object.
      if (
        method !== 'agent/getAuthenticatedExtendedCard' &&
        !this.paramsAreValid(rpcRequest.params)
      ) {
        throw A2AError.invalidParams('Invalid method parameters.');
      }

      if (method === 'message/stream' || method === 'tasks/resubscribe') {
        const agentCard = await this.requestHandler.getAgentCard();
        if (!agentCard.capabilities?.streaming) {
          throw A2AError.unsupportedOperation(`Method ${method} requires streaming capability.`);
        }
        const agentEventStream =
          method === 'message/stream'
            ? this.requestHandler.sendMessageStream(
                toCoreSendMessageRequest(rpcRequest as legacy.SendStreamingMessageRequest),
                context
              )
            : this.requestHandler.resubscribe(
                toCoreSubscribeToTaskRequest(rpcRequest as legacy.TaskResubscriptionRequest),
                context
              );

        return (async function* legacyJsonRpcEventStream(): AsyncGenerator<
          LegacyJSONRPCResponse,
          void,
          undefined
        > {
          try {
            for await (const event of agentEventStream) {
              yield toCompatStreamResponse(event, requestId);
            }
          } catch (streamError) {
            console.error(
              `Error in agent event stream for ${method} (request ${requestId}):`,
              streamError
            );
            throw streamError;
          }
        })();
      }

      let result: unknown;
      switch (method) {
        case 'message/send': {
          const messageOrTask = await this.requestHandler.sendMessage(
            toCoreSendMessageRequest(rpcRequest as legacy.SendMessageRequest),
            context
          );
          result =
            'messageId' in messageOrTask
              ? toCompatMessage(messageOrTask as V1Message)
              : toCompatTask(messageOrTask as V1Task);
          break;
        }
        case 'tasks/get':
          result = toCompatTask(
            await this.requestHandler.getTask(
              toCoreGetTaskRequest(rpcRequest as legacy.GetTaskRequest),
              context
            )
          );
          break;
        case 'tasks/cancel':
          result = toCompatTask(
            await this.requestHandler.cancelTask(
              toCoreCancelTaskRequest(rpcRequest as legacy.CancelTaskRequest),
              context
            )
          );
          break;
        case 'tasks/pushNotificationConfig/set':
          result = toCompatTaskPushNotificationConfig(
            await this.requestHandler.createTaskPushNotificationConfig(
              toCoreCreateTaskPushNotificationConfigRequest(
                rpcRequest as legacy.SetTaskPushNotificationConfigRequest
              ),
              context
            )
          );
          break;
        case 'tasks/pushNotificationConfig/get':
          result = toCompatTaskPushNotificationConfig(
            await this.requestHandler.getTaskPushNotificationConfig(
              toCoreGetTaskPushNotificationConfigRequest(
                rpcRequest as legacy.GetTaskPushNotificationConfigRequest
              ),
              context
            )
          );
          break;
        case 'tasks/pushNotificationConfig/list': {
          const listResponse = toCompatListTaskPushNotificationConfigSuccessResponse(
            await this.requestHandler.listTaskPushNotificationConfigs(
              toCoreListTaskPushNotificationConfigsRequest(
                rpcRequest as legacy.ListTaskPushNotificationConfigRequest
              ),
              context
            ),
            requestId
          );
          result = listResponse.result;
          break;
        }
        case 'tasks/pushNotificationConfig/delete':
          await this.requestHandler.deleteTaskPushNotificationConfig(
            toCoreDeleteTaskPushNotificationConfigRequest(
              rpcRequest as legacy.DeleteTaskPushNotificationConfigRequest
            ),
            context
          );
          result = null;
          break;
        case 'agent/getAuthenticatedExtendedCard':
          result = toCompatAgentCard(
            await this.requestHandler.getAuthenticatedExtendedAgentCard(
              toCoreGetExtendedAgentCardRequest(
                rpcRequest as legacy.GetAuthenticatedExtendedCardRequest
              ),
              context
            )
          );
          break;
        default:
          throw A2AError.methodNotFound(method);
      }

      return {
        jsonrpc: '2.0',
        id: requestId,
        result,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: requestId,
        error: LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError(error),
      };
    }
  }

  /** Validates the basic structure of a JSON-RPC request. */
  private isRequestValid(rpcRequest: LegacyA2ARequest): boolean {
    if (rpcRequest.jsonrpc !== '2.0') {
      return false;
    }
    if ('id' in rpcRequest) {
      const id = rpcRequest.id;
      const isString = typeof id === 'string';
      const isInteger = typeof id === 'number' && Number.isInteger(id);
      const isNull = id === null;

      if (!isString && !isInteger && !isNull) {
        return false;
      }
    }
    if (!rpcRequest.method || typeof rpcRequest.method !== 'string') {
      return false;
    }

    return true;
  }

  /** Validates that `params` is a non-null, non-array object with no empty keys. */
  private paramsAreValid(params: unknown): boolean {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      return false;
    }

    for (const key of Object.keys(params)) {
      if (key === '') {
        return false;
      }
    }
    return true;
  }

  /**
   * Maps an error to a v0.3-shaped {@link legacy.JSONRPCError}.
   *
   * Thin wrapper around {@link toCompatErrorBody} kept on the
   * transport handler for backward compatibility with existing call
   * sites (including the handler's own `catch` blocks). The actual
   * v1.0 → v0.3 demotion logic — pass `LegacyA2AError` through, map
   * known v1.0 SDK error classes to their numeric codes, strip the
   * enriched `details[]`/`ErrorInfo` payload — lives in the translate
   * unit and is shared with the REST handler.
   *
   * The cast is safe because the underlying converter returns a body
   * that is structurally identical to {@link legacy.JSONRPCError}.
   */
  public static mapToLegacyJSONRPCError(error: unknown): legacy.JSONRPCError {
    return toCompatErrorBody(error) as legacy.JSONRPCError;
  }
}

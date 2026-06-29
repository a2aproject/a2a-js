/**
 * v0.3 JSON-RPC transport handler. Accepts v0.3 method names and params,
 * translates to v1.0 proto, dispatches through `A2ARequestHandler`, and
 * translates the response back to the v0.3 JSON-RPC envelope.
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

type LegacyA2ARequest = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: string | number | null;
};

// `result` and `error` are mutually exclusive.
type LegacyJSONRPCResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: legacy.JSONRPCError;
};

export class LegacyJsonRpcTransportHandler {
  private requestHandler: A2ARequestHandler;

  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
  }

  /**
   * Handles an incoming v0.3 JSON-RPC request. Streaming methods
   * (`message/stream`, `tasks/resubscribe`) return an `AsyncGenerator`
   * of envelopes; non-streaming methods return a single envelope.
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
      // `agent/getAuthenticatedExtendedCard` carries no params; everything
      // else requires a params object.
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

  /** Maps an error to a v0.3-shaped `JSONRPCError`. */
  public static mapToLegacyJSONRPCError(error: unknown): legacy.JSONRPCError {
    return toCompatErrorBody(error) as legacy.JSONRPCError;
  }
}

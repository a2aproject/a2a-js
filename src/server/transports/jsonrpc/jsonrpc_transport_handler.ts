import {
  StreamResponse,
  Message,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  SendMessageRequest,
  SubscribeToTaskRequest,
  GetTaskRequest,
  CancelTaskRequest,
  TaskPushNotificationConfig,
  GetTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigsRequest,
} from '../../../index.js';
import {
  A2A_ERROR_CODE,
  RequestMalformedError,
  TaskNotFoundError,
  TaskNotCancelableError,
  PushNotificationNotSupportedError,
  UnsupportedOperationError,
  ContentTypeNotSupportedError,
  InvalidAgentResponseError,
  AuthenticatedExtendedCardNotConfiguredError,
  GenericError,
} from '../../../errors.js';
import { JSONRPCErrorResponse } from '../../../core.js';

export type A2ARequest = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: string | number | null;
};

export type JSONRPCResponse = {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: unknown;
};
import { ServerCallContext } from '../../context.js';
import { A2ARequestHandler } from '../../request_handler/a2a_request_handler.js';

/**
 * Handles JSON-RPC transport layer, routing requests to A2ARequestHandler.
 */
export class JsonRpcTransportHandler {
  private requestHandler: A2ARequestHandler;

  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
  }

  /**
   * Handles an incoming JSON-RPC request.
   * For streaming methods, it returns an AsyncGenerator of JSONRPCResult.
   * For non-streaming methods, it returns a Promise of a single JSONRPCMessage (Result or ErrorResponse).
   */
  public async handle(
    // TODO: remove the eslint disable and replace the any (https://github.com/a2aproject/a2a-js/issues/179)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requestBody: any,
    context?: ServerCallContext
  ): Promise<JSONRPCResponse | AsyncGenerator<JSONRPCResponse, void, undefined>> {
    let rpcRequest: A2ARequest;

    try {
      if (typeof requestBody === 'string') {
        rpcRequest = JSON.parse(requestBody);
      } else if (typeof requestBody === 'object' && requestBody !== null) {
        rpcRequest = requestBody as A2ARequest;
      } else {
        throw new RequestMalformedError('Invalid request body type.');
      }

      if (!this.isRequestValid(rpcRequest)) {
        throw new RequestMalformedError('Invalid JSON-RPC Request.');
      }
    } catch (error) {
      const mappedError = JsonRpcTransportHandler.mapToJSONRPCError(
        error instanceof SyntaxError
          ? new RequestMalformedError(error.message || 'Failed to parse JSON request.')
          : error
      );
      return {
        jsonrpc: '2.0',
        id: rpcRequest?.id !== undefined ? rpcRequest.id : null,
        error: mappedError,
      } as JSONRPCErrorResponse;
    }

    const { method, id: requestId = null } = rpcRequest;
    try {
      if (
        method !== 'agent/getAuthenticatedExtendedCard' &&
        !this.paramsAreValid(rpcRequest.params)
      ) {
        throw new RequestMalformedError(`Invalid method parameters.`);
      }

      if (method === 'message/stream' || method === 'tasks/resubscribe') {
        const params = rpcRequest.params;
        const agentCard = await this.requestHandler.getAgentCard();
        if (!agentCard.capabilities?.streaming) {
          throw new UnsupportedOperationError(`Method ${method} requires streaming capability.`);
        }
        const agentEventStream =
          method === 'message/stream'
            ? this.requestHandler.sendMessageStream(SendMessageRequest.fromJSON(params), context)
            : this.requestHandler.resubscribe(SubscribeToTaskRequest.fromJSON(params), context);

        // Wrap the agent event stream into a JSON-RPC result stream
        return (async function* jsonRpcEventStream(): AsyncGenerator<
          JSONRPCResponse,
          void,
          undefined
        > {
          try {
            for await (const event of agentEventStream) {
              let payload: StreamResponse['payload'];

              if ('messageId' in event) {
                payload = { $case: 'message', value: event as Message };
              } else if ('artifacts' in event) {
                payload = { $case: 'task', value: event as Task };
              } else if ('status' in event) {
                payload = { $case: 'statusUpdate', value: event as TaskStatusUpdateEvent };
              } else if ('artifact' in event) {
                payload = { $case: 'artifactUpdate', value: event as TaskArtifactUpdateEvent };
              }

              yield {
                jsonrpc: '2.0',
                id: requestId, // Use the original request ID for all streamed responses
                result: { payload },
              };
            }
          } catch (streamError) {
            // If the underlying agent stream throws an error, we need to yield a JSONRPCErrorResponse.
            // However, an AsyncGenerator is expected to yield JSONRPCResult.
            // This indicates an issue with how errors from the agent's stream are propagated.
            // For now, log it. The Express layer will handle the generator ending.
            console.error(
              `Error in agent event stream for ${method} (request ${requestId}):`,
              streamError
            );
            // Ideally, the Express layer should catch this and send a final error to the client if the stream breaks.
            // Or, the agentEventStream itself should yield a final error event that gets wrapped.
            // For now, we re-throw so it can be caught by the Express layer streaming support.
            throw streamError;
          }
        })();
      } else {
        // Handle non-streaming methods
        let result: unknown;
        switch (method) {
          case 'message/send': {
            const messageOrTask = await this.requestHandler.sendMessage(
              SendMessageRequest.fromJSON(rpcRequest.params),
              context
            );
            result = {
              payload: {
                $case: 'messageId' in messageOrTask ? 'message' : 'task',
                value: messageOrTask,
              },
            };
            break;
          }
          case 'tasks/get':
            result = await this.requestHandler.getTask(
              GetTaskRequest.fromJSON(rpcRequest.params),
              context
            );
            break;
          case 'tasks/cancel':
            result = await this.requestHandler.cancelTask(
              CancelTaskRequest.fromJSON(rpcRequest.params),
              context
            );
            break;
          case 'tasks/pushNotificationConfig/create': {
            result = await this.requestHandler.createTaskPushNotificationConfig(
              TaskPushNotificationConfig.fromJSON(rpcRequest.params),
              context
            );
            break;
          }
          case 'tasks/pushNotificationConfig/get':
            result = await this.requestHandler.getTaskPushNotificationConfig(
              GetTaskPushNotificationConfigRequest.fromJSON(rpcRequest.params),
              context
            );
            break;
          case 'tasks/pushNotificationConfig/delete':
            await this.requestHandler.deleteTaskPushNotificationConfig(
              DeleteTaskPushNotificationConfigRequest.fromJSON(rpcRequest.params),
              context
            );
            result = null;
            break;
          case 'tasks/pushNotificationConfig/list':
            result = await this.requestHandler.listTaskPushNotificationConfigs(
              ListTaskPushNotificationConfigsRequest.fromJSON(rpcRequest.params),
              context
            );
            break;
          case 'agent/getAuthenticatedExtendedCard':
            result = await this.requestHandler.getAuthenticatedExtendedAgentCard(context);
            break;
          default:
            return {
              jsonrpc: '2.0',
              id: requestId,
              error: { code: A2A_ERROR_CODE.METHOD_NOT_FOUND, message: 'Invalid method.' },
            };
        }
        return {
          jsonrpc: '2.0',
          id: requestId,
          result: result,
        } as JSONRPCResponse;
      }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: requestId,
        error: JsonRpcTransportHandler.mapToJSONRPCError(error),
      } as JSONRPCErrorResponse;
    }
  }

  // Validates the basic structure of a JSON-RPC request
  private isRequestValid(rpcRequest: A2ARequest): boolean {
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

  // Validates that params is an object with non-empty string keys
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

  public static mapToJSONRPCError(error: unknown) {
    if (error instanceof TaskNotFoundError) {
      return { code: A2A_ERROR_CODE.TASK_NOT_FOUND, message: error.message };
    }
    if (error instanceof TaskNotCancelableError) {
      return { code: A2A_ERROR_CODE.TASK_NOT_CANCELABLE, message: error.message };
    }
    if (error instanceof PushNotificationNotSupportedError) {
      return { code: A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED, message: error.message };
    }
    if (error instanceof UnsupportedOperationError) {
      return { code: A2A_ERROR_CODE.UNSUPPORTED_OPERATION, message: error.message };
    }
    if (error instanceof ContentTypeNotSupportedError) {
      return { code: A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED, message: error.message };
    }
    if (error instanceof InvalidAgentResponseError) {
      return { code: A2A_ERROR_CODE.INVALID_AGENT_RESPONSE, message: error.message };
    }
    if (error instanceof AuthenticatedExtendedCardNotConfiguredError) {
      return {
        code: A2A_ERROR_CODE.AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED,
        message: error.message,
      };
    }
    if (error instanceof RequestMalformedError) {
      return { code: A2A_ERROR_CODE.INVALID_PARAMS, message: error.message };
    }
    if (error instanceof GenericError) {
      return { code: A2A_ERROR_CODE.INTERNAL_ERROR, message: error.message };
    }

    const message = (error instanceof Error && error.message) || 'An unexpected error occurred.';
    return { code: A2A_ERROR_CODE.INTERNAL_ERROR, message };
  }
}

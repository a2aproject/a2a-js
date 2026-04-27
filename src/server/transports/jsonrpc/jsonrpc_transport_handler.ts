import {
  Message,
  Task,
  StreamResponse,
  SendMessageRequest,
  SubscribeToTaskRequest,
  GetTaskRequest,
  GetExtendedAgentCardRequest,
  CancelTaskRequest,
  TaskPushNotificationConfig,
  GetTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTasksRequest,
  ListTasksResponse,
  ListTaskPushNotificationConfigsResponse,
  AgentCard,
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
  GenericError,
  VersionNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  buildErrorInfo,
  type ErrorDetail,
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
    requestBody: string | Record<string, unknown>,
    context: ServerCallContext
  ): Promise<JSONRPCResponse | AsyncGenerator<JSONRPCResponse, void, undefined>> {
    let rpcRequest: A2ARequest = { jsonrpc: '2.0', method: '' };
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
        id: rpcRequest.id ?? null,
        error: mappedError,
      } as JSONRPCErrorResponse;
    }

    const { method, id: requestId = null } = rpcRequest;
    try {
      if (method !== 'GetExtendedAgentCard' && !this.paramsAreValid(rpcRequest.params)) {
        throw new RequestMalformedError(`Invalid method parameters.`);
      }

      // For JSON-RPC, tenant is inside the params body. Extract it and enrich the
      // context so downstream components (stores, executors) can scope by tenant.
      const paramsTenant = (rpcRequest.params as Record<string, unknown> | undefined)?.tenant as
        | string
        | undefined;
      if (paramsTenant && !context.tenant) {
        context = new ServerCallContext({
          requestedExtensions: context.requestedExtensions,
          user: context.user,
          requestedVersion: context.requestedVersion,
          tenant: paramsTenant,
        });
      }

      if (method === 'SendStreamingMessage' || method === 'SubscribeToTask') {
        const params = rpcRequest.params;
        const agentCard = await this.requestHandler.getAgentCard();
        if (!agentCard.capabilities?.streaming) {
          throw new UnsupportedOperationError(`Method ${method} requires streaming capability.`);
        }
        const agentEventStream =
          method === 'SendStreamingMessage'
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
              yield {
                jsonrpc: '2.0',
                id: requestId,
                result: StreamResponse.toJSON(event),
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
          case 'SendMessage': {
            const messageOrTask = await this.requestHandler.sendMessage(
              SendMessageRequest.fromJSON(rpcRequest.params),
              context
            );
            result =
              'messageId' in messageOrTask
                ? { message: Message.toJSON(messageOrTask as Message) }
                : { task: Task.toJSON(messageOrTask as Task) };
            break;
          }
          case 'GetTask':
            result = Task.toJSON(
              await this.requestHandler.getTask(GetTaskRequest.fromJSON(rpcRequest.params), context)
            );
            break;
          case 'ListTasks':
            result = ListTasksResponse.toJSON(
              await this.requestHandler.listTasks(
                ListTasksRequest.fromJSON(rpcRequest.params),
                context
              )
            );
            break;
          case 'CancelTask':
            result = Task.toJSON(
              await this.requestHandler.cancelTask(
                CancelTaskRequest.fromJSON(rpcRequest.params),
                context
              )
            );
            break;
          case 'CreateTaskPushNotificationConfig': {
            result = TaskPushNotificationConfig.toJSON(
              await this.requestHandler.createTaskPushNotificationConfig(
                TaskPushNotificationConfig.fromJSON(rpcRequest.params),
                context
              )
            );
            break;
          }
          case 'GetTaskPushNotificationConfig':
            result = TaskPushNotificationConfig.toJSON(
              await this.requestHandler.getTaskPushNotificationConfig(
                GetTaskPushNotificationConfigRequest.fromJSON(rpcRequest.params),
                context
              )
            );
            break;
          case 'DeleteTaskPushNotificationConfig':
            await this.requestHandler.deleteTaskPushNotificationConfig(
              DeleteTaskPushNotificationConfigRequest.fromJSON(rpcRequest.params),
              context
            );
            result = null;
            break;
          case 'ListTaskPushNotificationConfigs':
            result = ListTaskPushNotificationConfigsResponse.toJSON(
              await this.requestHandler.listTaskPushNotificationConfigs(
                ListTaskPushNotificationConfigsRequest.fromJSON(rpcRequest.params),
                context
              )
            );
            break;
          case 'GetExtendedAgentCard':
            result = AgentCard.toJSON(
              await this.requestHandler.getAuthenticatedExtendedAgentCard(
                GetExtendedAgentCardRequest.fromJSON(rpcRequest.params),
                context
              )
            );
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

  public static mapToJSONRPCError(error: unknown): {
    code: number;
    message: string;
    data?: ErrorDetail[];
  } {
    const codeMap: Array<[abstract new (...args: never[]) => Error, number]> = [
      [TaskNotFoundError, A2A_ERROR_CODE.TASK_NOT_FOUND],
      [TaskNotCancelableError, A2A_ERROR_CODE.TASK_NOT_CANCELABLE],
      [PushNotificationNotSupportedError, A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED],
      [UnsupportedOperationError, A2A_ERROR_CODE.UNSUPPORTED_OPERATION],
      [ContentTypeNotSupportedError, A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED],
      [InvalidAgentResponseError, A2A_ERROR_CODE.INVALID_AGENT_RESPONSE],
      [ExtendedAgentCardNotConfiguredError, A2A_ERROR_CODE.EXTENDED_CARD_NOT_CONFIGURED],
      [VersionNotSupportedError, A2A_ERROR_CODE.VERSION_NOT_SUPPORTED],
      [RequestMalformedError, A2A_ERROR_CODE.INVALID_PARAMS],
      [GenericError, A2A_ERROR_CODE.INTERNAL_ERROR],
    ];

    for (const [ErrorClass, code] of codeMap) {
      if (error instanceof ErrorClass) {
        const data: ErrorDetail[] = [];
        const errorInfo = buildErrorInfo(error);
        if (errorInfo) data.push(errorInfo);
        return { code, message: error.message, ...(data.length > 0 ? { data } : {}) };
      }
    }

    const message = (error instanceof Error && error.message) || 'An unexpected error occurred.';
    return { code: A2A_ERROR_CODE.INTERNAL_ERROR, message };
  }
}

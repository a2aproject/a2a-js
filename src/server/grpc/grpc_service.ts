import * as grpc from '@grpc/grpc-js';
import {
  A2AServiceServer,
  AgentCard,
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetExtendedAgentCardRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  ListTasksRequest,
  ListTasksResponse,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  TaskPushNotificationConfig,
} from '../../grpc/pb/a2a.js';
import { Empty } from '../../grpc/pb/google/protobuf/empty.js';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { ToProto } from '../../types/converters/to_proto.js';
import { ServerCallContext } from '../context.js';
import { Extensions } from '../../extensions.js';
import { UserBuilder } from './common.js';
import { HTTP_EXTENSION_HEADER } from '../../constants.js';
import {
  AuthenticatedExtendedCardNotConfiguredError,
  ContentTypeNotSupportedError,
  InvalidAgentResponseError,
  RequestMalformedError,
  GenericError,
  PushNotificationNotSupportedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from '../../errors.js';

/**
 * Options for configuring the gRPC handler.
 */
export interface GrpcServiceOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
}

/**
 * Creates a gRPC transport handler.
 * This handler implements the A2A gRPC service definition and acts as an
 * adapter between the gRPC transport layer and the core A2A request handler.
 *
 * @param requestHandler - The core A2A request handler for business logic.
 * @returns An object that implements the A2AServiceServer interface.
 *
 * @example
 * ```ts
 * const server = new grpc.Server();
 * const requestHandler = new DefaultRequestHandler(...);
 * server.addService(A2AService, grpcService({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
 * ```
 */
export function grpcService(options: GrpcServiceOptions): A2AServiceServer {
  const requestHandler = options.requestHandler;

  /**
   * Helper to wrap Unary calls with common logic (context, metadata, error handling)
   */
  const wrapUnary = async <TReq, TRes, TParams, TResult>(
    call: grpc.ServerUnaryCall<TReq, TRes>,
    callback: grpc.sendUnaryData<TRes>,
    parser: (req: TReq) => TParams,
    handler: (params: TParams, ctx: ServerCallContext) => Promise<TResult>,
    converter: (res: TResult) => TRes
  ) => {
    try {
      const context = await buildContext(call, options.userBuilder);
      const params = parser(call.request);
      const result = await handler(params, context);
      call.sendMetadata(buildMetadata(context));
      callback(null, converter(result));
    } catch (error) {
      callback(mapToError(error), null);
    }
  };

  /**
   * Helper to wrap Streaming calls with common logic (context, metadata, error handling)
   */
  const wrapStreaming = async <TReq, TRes, TParams, TResult>(
    call: grpc.ServerWritableStream<TReq, TRes>,
    parser: (req: TReq) => TParams,
    handler: (params: TParams, ctx: ServerCallContext) => AsyncGenerator<TResult>,
    converter: (res: TResult) => TRes
  ) => {
    try {
      const context = await buildContext(call, options.userBuilder);
      const params = parser(call.request);
      const stream = await handler(params, context);
      const metadata = buildMetadata(context);
      call.sendMetadata(metadata);
      for await (const responsePart of stream) {
        const response = converter(responsePart);
        call.write(response);
      }
    } catch (error) {
      call.emit('error', mapToError(error));
    } finally {
      call.end();
    }
  };

  return {
    sendMessage(
      call: grpc.ServerUnaryCall<SendMessageRequest, SendMessageResponse>,
      callback: grpc.sendUnaryData<SendMessageResponse>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        (req) => req,
        requestHandler.sendMessage.bind(requestHandler),
        ToProto.messageSendResult
      );
    },

    sendStreamingMessage(
      call: grpc.ServerWritableStream<SendMessageRequest, StreamResponse>
    ): Promise<void> {
      return wrapStreaming(
        call,
        (req) => req,
        requestHandler.sendMessageStream.bind(requestHandler),
        ToProto.messageStreamResult
      );
    },

    subscribeToTask(
      call: grpc.ServerWritableStream<SubscribeToTaskRequest, StreamResponse>
    ): Promise<void> {
      return wrapStreaming(
        call,
        (req) => req,
        requestHandler.resubscribe.bind(requestHandler),
        ToProto.messageStreamResult
      );
    },

    deleteTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<DeleteTaskPushNotificationConfigRequest, Empty>,
      callback: grpc.sendUnaryData<Empty>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        (req) => req,
        requestHandler.deleteTaskPushNotificationConfig.bind(requestHandler),
        () => ({})
      );
    },

    listTaskPushNotificationConfigs(
      call: grpc.ServerUnaryCall<
        ListTaskPushNotificationConfigsRequest,
        ListTaskPushNotificationConfigsResponse
      >,
      callback: grpc.sendUnaryData<ListTaskPushNotificationConfigsResponse>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        (req) => req,
        requestHandler.listTaskPushNotificationConfigs.bind(requestHandler),
        ToProto.listTaskPushNotificationConfig
      );
    },

    createTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<TaskPushNotificationConfig, TaskPushNotificationConfig>,
      callback: grpc.sendUnaryData<TaskPushNotificationConfig>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        (req) => req,
        requestHandler.createTaskPushNotificationConfig.bind(requestHandler),
        (res) => res
      );
    },

    getTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<GetTaskPushNotificationConfigRequest, TaskPushNotificationConfig>,
      callback: grpc.sendUnaryData<TaskPushNotificationConfig>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        (req) => req,
        requestHandler.getTaskPushNotificationConfig.bind(requestHandler),
        (res) => res
      );
    },

    getTask(
      call: grpc.ServerUnaryCall<GetTaskRequest, Task>,
      callback: grpc.sendUnaryData<Task>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        (req) => req,
        requestHandler.getTask.bind(requestHandler),
        (res) => res
      );
    },

    cancelTask(
      call: grpc.ServerUnaryCall<CancelTaskRequest, Task>,
      callback: grpc.sendUnaryData<Task>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        (req) => req,
        requestHandler.cancelTask.bind(requestHandler),
        (res) => res
      );
    },

    getExtendedAgentCard(
      call: grpc.ServerUnaryCall<GetExtendedAgentCardRequest, AgentCard>,
      callback: grpc.sendUnaryData<AgentCard>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        () => ({}),
        (_params, context) => requestHandler.getAuthenticatedExtendedAgentCard(context),
        (res) => res
      );
    },
    listTasks(
      _call: grpc.ServerUnaryCall<ListTasksRequest, ListTasksResponse>,
      _callback: grpc.sendUnaryData<ListTasksResponse>
    ): Promise<void> {
      throw new UnsupportedOperationError('Method listTasks not implemented yet.');
    },
  };
}

// --- Internal Helpers ---

/**
 * Maps A2AError or standard Error to gRPC Status codes
 */
const mapToError = (error: unknown): Partial<grpc.ServiceError> => {
  let code = grpc.status.UNKNOWN;
  if (error instanceof TaskNotFoundError) code = grpc.status.NOT_FOUND;
  else if (error instanceof TaskNotCancelableError) code = grpc.status.FAILED_PRECONDITION;
  else if (error instanceof PushNotificationNotSupportedError) code = grpc.status.UNIMPLEMENTED;
  else if (error instanceof UnsupportedOperationError) code = grpc.status.UNIMPLEMENTED;
  else if (error instanceof ContentTypeNotSupportedError) code = grpc.status.INVALID_ARGUMENT;
  else if (error instanceof InvalidAgentResponseError) code = grpc.status.INTERNAL;
  else if (error instanceof AuthenticatedExtendedCardNotConfiguredError)
    code = grpc.status.FAILED_PRECONDITION;
  else if (error instanceof RequestMalformedError) code = grpc.status.INVALID_ARGUMENT;
  else if (error instanceof GenericError) code = grpc.status.INTERNAL;

  const message = error instanceof Error ? error.message : 'Internal server error';

  return {
    code,
    details: message,
  };
};

const buildContext = async (
  call: grpc.ServerUnaryCall<unknown, unknown> | grpc.ServerWritableStream<unknown, unknown>,
  userBuilder: UserBuilder
): Promise<ServerCallContext> => {
  const user = await userBuilder(call);
  const extensionHeaders = call.metadata.get(HTTP_EXTENSION_HEADER);
  const extensionString = extensionHeaders.map((v) => v.toString()).join(',');

  return new ServerCallContext(Extensions.parseServiceParameter(extensionString), user);
};

const buildMetadata = (context: ServerCallContext): grpc.Metadata => {
  const metadata = new grpc.Metadata();
  if (context.activatedExtensions?.length) {
    metadata.set(HTTP_EXTENSION_HEADER, context.activatedExtensions.join(','));
  }
  return metadata;
};

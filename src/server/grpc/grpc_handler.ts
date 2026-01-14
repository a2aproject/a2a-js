import * as grpc from '@grpc/grpc-js';
import {
  A2AServiceServer,
  AgentCard,
  CancelTaskRequest,
  CreateTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetAgentCardRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigResponse,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskPushNotificationConfig,
  TaskSubscriptionRequest,
} from '../../grpc/a2a_services.js';
import { Empty } from '../../grpc/google/protobuf/empty.js';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { FromProto } from '../../types/converters/from_proto.js';
import { ToProto } from '../../types/converters/to_proto.js';
import { GrpcTransportHandler } from '../transports/grpc/grpc_transport_handler.js';
import { ServerCallContext } from '../context.js';
import { Extensions } from '../../extensions.js';
import { UserBuilder } from './common.js';
import { HTTP_EXTENSION_HEADER } from '../../constants.js';
import { A2AError } from '../error.js';

/**
 * Options for configuring the gRPC handler.
 */
export interface GrpcHandlerOptions {
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
 * server.addService(A2AService, grpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
 * ```
 */
export function grpcHandler(options: GrpcHandlerOptions): A2AServiceServer {
  const grpcTransportHandler = new GrpcTransportHandler(options.requestHandler);

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
        FromProto.messageSendParams,
        grpcTransportHandler.sendMessage.bind(grpcTransportHandler),
        ToProto.messageSendResult
      );
    },

    sendStreamingMessage(
      call: grpc.ServerWritableStream<SendMessageRequest, StreamResponse>
    ): Promise<void> {
      return wrapStreaming(
        call,
        FromProto.messageSendParams,
        grpcTransportHandler.sendMessageStream.bind(grpcTransportHandler),
        ToProto.messageStreamResult
      );
    },

    taskSubscription(
      call: grpc.ServerWritableStream<TaskSubscriptionRequest, StreamResponse>
    ): Promise<void> {
      return wrapStreaming(
        call,
        FromProto.taskIdParams,
        grpcTransportHandler.resubscribe.bind(grpcTransportHandler),
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
        FromProto.deleteTaskPushNotificationConfigParams,
        grpcTransportHandler.deleteTaskPushNotificationConfig.bind(grpcTransportHandler),
        () => ({})
      );
    },

    listTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<
        ListTaskPushNotificationConfigRequest,
        ListTaskPushNotificationConfigResponse
      >,
      callback: grpc.sendUnaryData<ListTaskPushNotificationConfigResponse>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        FromProto.listTaskPushNotificationConfigParams,
        grpcTransportHandler.listTaskPushNotificationConfigs.bind(grpcTransportHandler),
        ToProto.listTaskPushNotificationConfig
      );
    },

    createTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<
        CreateTaskPushNotificationConfigRequest,
        TaskPushNotificationConfig
      >,
      callback: grpc.sendUnaryData<TaskPushNotificationConfig>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        FromProto.createTaskPushNotificationConfig,
        grpcTransportHandler.setTaskPushNotificationConfig.bind(grpcTransportHandler),
        ToProto.taskPushNotificationConfig
      );
    },

    getTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<GetTaskPushNotificationConfigRequest, TaskPushNotificationConfig>,
      callback: grpc.sendUnaryData<TaskPushNotificationConfig>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        FromProto.getTaskPushNotificationConfigParams,
        grpcTransportHandler.getTaskPushNotificationConfig.bind(grpcTransportHandler),
        ToProto.taskPushNotificationConfig
      );
    },

    getTask(
      call: grpc.ServerUnaryCall<GetTaskRequest, Task>,
      callback: grpc.sendUnaryData<Task>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        FromProto.taskQueryParams,
        grpcTransportHandler.getTask.bind(grpcTransportHandler),
        ToProto.task
      );
    },

    cancelTask(
      call: grpc.ServerUnaryCall<CancelTaskRequest, Task>,
      callback: grpc.sendUnaryData<Task>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        FromProto.taskIdParams,
        grpcTransportHandler.cancelTask.bind(grpcTransportHandler),
        ToProto.task
      );
    },

    getAgentCard(
      call: grpc.ServerUnaryCall<GetAgentCardRequest, AgentCard>,
      callback: grpc.sendUnaryData<AgentCard>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        () => ({}),
        (_params, _context) => grpcTransportHandler.getAgentCard(),
        ToProto.agentCard
      );
    },
  };
}

// --- Internal Helpers ---

/**
 * Maps A2AError or standard Error to gRPC Status codes
 */
const mapping: Record<number, grpc.status> = {
  [-32001]: grpc.status.NOT_FOUND,
  [-32002]: grpc.status.FAILED_PRECONDITION,
  [-32003]: grpc.status.UNIMPLEMENTED,
  [-32004]: grpc.status.UNIMPLEMENTED,
  [-32005]: grpc.status.INVALID_ARGUMENT,
  [-32006]: grpc.status.INTERNAL,
  [-32007]: grpc.status.FAILED_PRECONDITION,
  [-32600]: grpc.status.INVALID_ARGUMENT,
  [-32601]: grpc.status.UNIMPLEMENTED,
  [-32602]: grpc.status.INVALID_ARGUMENT,
  [-32603]: grpc.status.INTERNAL,
  [-32700]: grpc.status.INTERNAL,
};

const mapToError = (error: unknown): Partial<grpc.ServiceError> => {
  const a2aError =
    error instanceof A2AError
      ? error
      : A2AError.internalError(error instanceof Error ? error.message : 'Unknown Error');

  const metadata = new grpc.Metadata();
  metadata.set('a2a-error-code', a2aError.code.toString());
  return {
    message: a2aError.message,
    code: mapping[a2aError.code] ?? grpc.status.INTERNAL,
    details: a2aError.message,
    metadata: metadata,
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

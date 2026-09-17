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
import {
  ServerCallContext,
  ServerCallContextBuilder,
  defaultServerCallContextBuilder,
} from '../context.js';
import { Extensions } from '../../extensions.js';
import { UserBuilder } from './common.js';
import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER } from '../../constants.js';
import { A2AError } from '../../errors/index.js';
import {
  buildGrpcErrorMetadata,
  GRPC_STATUS_CODE,
  grpcStatusFor,
} from '../../errors/grpc/index.js';
import { validateVersion } from '../version.js';

/** Options for configuring the gRPC handler. */
export interface GrpcServiceOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
  contextBuilder?: ServerCallContextBuilder;
}

/**
 * Creates a gRPC service implementation adapting an {@link A2ARequestHandler}.
 *
 * @example
 * ```ts
 * const server = new grpc.Server();
 * server.addService(
 *   A2AService,
 *   grpcService({ requestHandler, userBuilder: UserBuilder.noAuthentication })
 * );
 * ```
 */
export function grpcService(options: GrpcServiceOptions): A2AServiceServer {
  const requestHandler = options.requestHandler;

  const wrapUnaryWithConverter = async <TReq, TRes, TResult>(
    call: grpc.ServerUnaryCall<TReq, TRes>,
    callback: grpc.sendUnaryData<TRes>,
    handler: (req: TReq, ctx: ServerCallContext) => Promise<TResult>,
    converter: (res: TResult) => TRes
  ) => {
    try {
      const context = await _buildContext(
        call,
        options.userBuilder,
        requestHandler,
        options.contextBuilder
      );
      const result = await handler(call.request, context);
      call.sendMetadata(buildMetadata(context));
      callback(null, converter(result));
    } catch (error) {
      callback(mapToError(error), null);
    }
  };

  const wrapUnary = async <TReq, TRes>(
    call: grpc.ServerUnaryCall<TReq, TRes>,
    callback: grpc.sendUnaryData<TRes>,
    handler: (req: TReq, ctx: ServerCallContext) => Promise<TRes>
  ) => {
    return wrapUnaryWithConverter(call, callback, handler, (res: TRes) => res);
  };

  const wrapStreaming = async <TReq, TRes>(
    call: grpc.ServerWritableStream<TReq, TRes>,
    handler: (req: TReq, ctx: ServerCallContext) => AsyncGenerator<TRes>
  ) => {
    try {
      const context = await _buildContext(
        call,
        options.userBuilder,
        requestHandler,
        options.contextBuilder
      );
      const stream = await handler(call.request, context);
      call.sendMetadata(buildMetadata(context));
      for await (const responsePart of stream) {
        call.write(responsePart);
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
      return wrapUnaryWithConverter(
        call,
        callback,
        requestHandler.sendMessage.bind(requestHandler),
        ToProto.messageSendResult
      );
    },

    sendStreamingMessage(
      call: grpc.ServerWritableStream<SendMessageRequest, StreamResponse>
    ): Promise<void> {
      return wrapStreaming(call, requestHandler.sendMessageStream.bind(requestHandler));
    },

    subscribeToTask(
      call: grpc.ServerWritableStream<SubscribeToTaskRequest, StreamResponse>
    ): Promise<void> {
      return wrapStreaming(call, requestHandler.resubscribe.bind(requestHandler));
    },

    deleteTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<DeleteTaskPushNotificationConfigRequest, Empty>,
      callback: grpc.sendUnaryData<Empty>
    ): Promise<void> {
      return wrapUnaryWithConverter(
        call,
        callback,
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
        requestHandler.listTaskPushNotificationConfigs.bind(requestHandler)
      );
    },

    createTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<TaskPushNotificationConfig, TaskPushNotificationConfig>,
      callback: grpc.sendUnaryData<TaskPushNotificationConfig>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        requestHandler.createTaskPushNotificationConfig.bind(requestHandler)
      );
    },

    getTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<GetTaskPushNotificationConfigRequest, TaskPushNotificationConfig>,
      callback: grpc.sendUnaryData<TaskPushNotificationConfig>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        requestHandler.getTaskPushNotificationConfig.bind(requestHandler)
      );
    },

    getTask(
      call: grpc.ServerUnaryCall<GetTaskRequest, Task>,
      callback: grpc.sendUnaryData<Task>
    ): Promise<void> {
      return wrapUnary(call, callback, requestHandler.getTask.bind(requestHandler));
    },

    cancelTask(
      call: grpc.ServerUnaryCall<CancelTaskRequest, Task>,
      callback: grpc.sendUnaryData<Task>
    ): Promise<void> {
      return wrapUnary(call, callback, requestHandler.cancelTask.bind(requestHandler));
    },

    getExtendedAgentCard(
      call: grpc.ServerUnaryCall<GetExtendedAgentCardRequest, AgentCard>,
      callback: grpc.sendUnaryData<AgentCard>
    ): Promise<void> {
      return wrapUnary(call, callback, (params, context) =>
        requestHandler.getAuthenticatedExtendedAgentCard(params, context)
      );
    },
    listTasks(
      call: grpc.ServerUnaryCall<ListTasksRequest, ListTasksResponse>,
      callback: grpc.sendUnaryData<ListTasksResponse>
    ): Promise<void> {
      return wrapUnary(call, callback, requestHandler.listTasks.bind(requestHandler));
    },
  };
}

/**
 * Maps an error to a gRPC error with status details. For {@link A2AError}
 * instances, attaches `google.rpc.ErrorInfo` in `grpc-status-details-bin`.
 * The gRPC status comes from the semantic error's registry entry
 * (`grpcStatusFor`), so user-defined subclasses inherit the base status.
 */
const mapToError = (error: unknown): Partial<grpc.ServiceError> => {
  const code = error instanceof A2AError ? grpcStatusFor(error) : GRPC_STATUS_CODE.UNKNOWN;
  const message = error instanceof Error ? error.message : 'Internal server error';
  const result: Partial<grpc.ServiceError> = { code, details: message };
  const md = buildGrpcErrorMetadata(grpc.Metadata, error);
  if (md) result.metadata = md;
  return result;
};

const _buildContext = async (
  call: grpc.ServerUnaryCall<unknown, unknown> | grpc.ServerWritableStream<unknown, unknown>,
  userBuilder: UserBuilder,
  requestHandler: A2ARequestHandler,
  contextBuilder?: ServerCallContextBuilder
): Promise<ServerCallContext> => {
  const user = await userBuilder(call);
  const extensionHeaders = call.metadata.get(HTTP_EXTENSION_HEADER);
  const extensionString = extensionHeaders.map((v) => v.toString()).join(',');

  // Convert gRPC metadata to the transport-agnostic RequestHeaders shape.
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(call.metadata.getMap())) {
    headers[key] = value.toString();
  }

  // gRPC metadata keys are normalized to lowercase per gRPC conventions (§10.2).
  const versionHeaders = call.metadata.get(A2A_VERSION_HEADER.toLowerCase());
  const requestedVersion = versionHeaders.length > 0 ? versionHeaders[0].toString() : undefined;
  const tenant = (call.request as Record<string, unknown>)?.tenant as string | undefined;

  const ctxBuilder = contextBuilder ?? defaultServerCallContextBuilder;
  const context = ctxBuilder({
    extensions: Extensions.parseServiceParameter(extensionString),
    user,
    headers,
    requestedVersion,
    tenant,
  });

  const agentCard = await requestHandler.getAgentCard();
  validateVersion(context.requestedVersion, agentCard, 'GRPC');

  return context;
};

const buildMetadata = (context: ServerCallContext): grpc.Metadata => {
  const metadata = new grpc.Metadata();
  if (context.activatedExtensions?.length) {
    metadata.set(HTTP_EXTENSION_HEADER, context.activatedExtensions.join(','));
  }
  return metadata;
};

/**
 * v0.3 gRPC service handler (compat layer).
 *
 * Implements the v0.3 `A2AServiceServer` interface but dispatches to the
 * v1.0 {@link A2ARequestHandler}. Each method translates the inbound v0.3
 * protobuf request into the v1.0 proto types the request handler speaks
 * (via {@link FromProto} + the v0.3 `toCore*` translators), invokes the
 * handler, and translates the v1.0 proto response back into the v0.3
 * protobuf shape on the wire (via the v0.3 `toCompat*` translators +
 * {@link ToProto}).
 *
 * Designed to be registered side-by-side with the v1.0 `grpcService`: the
 * two services share a gRPC `Server` and an `A2ARequestHandler` but
 * advertise different proto service descriptors, so they coexist on the
 * same port without method-name collisions even though both are scoped
 * under the `a2a.v1.A2AService` proto package name.
 *
 *     const server = new grpc.Server();
 *     server.addService(A2AService,       grpcService(...));        // v1.0
 *     server.addService(LegacyA2AService, legacyGrpcService(...));  // v0.3
 *
 * Errors are mapped via an `instanceof` chain (matching the v1.0
 * `grpcService`) and enriched with `google.rpc.ErrorInfo` in
 * `grpc-status-details-bin` so v1.0-aware clients connecting to a v0.3
 * server still benefit from §10.6's enriched error model; v0.3 clients
 * that don't decode the binary status simply ignore it.
 */

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
} from '../../grpc/pb/a2a.js';
import { Empty } from '../../grpc/pb/google/protobuf/empty.js';
import { A2ARequestHandler } from '../../../../server/request_handler/a2a_request_handler.js';
import { ServerCallContext } from '../../../../server/context.js';
import { Extensions } from '../../../../extensions.js';
import { buildGrpcErrorMetadata } from '../../../../server/grpc/error_details.js';
import { UserBuilder } from './common.js';
import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER } from '../../../../constants.js';
import { LEGACY_HTTP_EXTENSION_HEADER } from '../../constants.js';
import {
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  GenericError,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
} from '../../../../errors.js';
import { validateVersion } from '../../../../server/version.js';
import { FromProto } from '../../types/converters/from_proto.js';
import { ToProto } from '../../types/converters/to_proto.js';
import {
  extractTaskAndPushNotificationConfigId,
  extractTaskId,
} from '../../types/converters/id_decoding.js';
import {
  toCompatAgentCard,
  toCompatMessage,
  toCompatTask,
  toCompatTaskArtifactUpdateEvent,
  toCompatTaskPushNotificationConfig,
  toCompatTaskStatusUpdateEvent,
  toCoreCancelTaskRequest,
  toCoreCreateTaskPushNotificationConfigRequest,
  toCoreDeleteTaskPushNotificationConfigRequest,
  toCoreGetExtendedAgentCardRequest,
  toCoreGetTaskPushNotificationConfigRequest,
  toCoreGetTaskRequest,
  toCoreListTaskPushNotificationConfigsRequest,
  toCoreSendMessageRequest,
  toCoreSubscribeToTaskRequest,
} from '../../translate/index.js';
import type * as legacy from '../../types/types.js';
import type {
  ListTaskPushNotificationConfigsResponse as V1ListTaskPushNotificationConfigsResponse,
  Message as V1Message,
  StreamResponse as V1StreamResponse,
  Task as V1Task,
  TaskPushNotificationConfig as V1TaskPushNotificationConfig,
} from '../../../../types/pb/a2a.js';

/**
 * Options for configuring the v0.3 gRPC service handler.
 *
 * Shares the same shape as {@link import('../../../../server/grpc/grpc_service.js').GrpcServiceOptions}
 * so operators can build a single options object and pass it to both
 * `grpcService` (v1.0) and `legacyGrpcService` (v0.3).
 */
export interface LegacyGrpcServiceOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
}

/**
 * Creates a v0.3 gRPC service handler.
 *
 * The returned object implements the v0.3 `A2AServiceServer` interface
 * generated into `src/compat/v0_3/types/pb/a2a.ts`; register it on a
 * gRPC `Server` against the `LegacyA2AService` descriptor exported from
 * the same module.
 *
 * @param options - The v0.3 service options.
 * @returns An object implementing the v0.3 `A2AServiceServer` interface.
 *
 * @example
 * ```ts
 * import * as grpc from '@grpc/grpc-js';
 * import { DefaultRequestHandler, UserBuilder } from '@a2a-js/sdk/server';
 * import {
 *   A2AService,
 *   grpcService,
 *   LegacyA2AService,
 *   legacyGrpcService,
 * } from '@a2a-js/sdk/server/grpc';
 *
 * const requestHandler = new DefaultRequestHandler(...);
 * const server = new grpc.Server();
 * server.addService(A2AService,       grpcService({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
 * server.addService(LegacyA2AService, legacyGrpcService({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
 * ```
 */
export function legacyGrpcService(options: LegacyGrpcServiceOptions): A2AServiceServer {
  const requestHandler = options.requestHandler;

  /**
   * Helper to wrap unary calls with shared context/metadata/error logic.
   *
   * `parser` maps the inbound v0.3 pb request to whatever shape the v1.0
   * `requestHandler` expects (i.e. v1.0 proto). `converter` maps the v1.0
   * proto response back into the v0.3 pb response on the wire.
   */
  const wrapUnary = async <TPbReq, TPbRes, TCoreReq, TCoreRes>(
    call: grpc.ServerUnaryCall<TPbReq, TPbRes>,
    callback: grpc.sendUnaryData<TPbRes>,
    parser: (req: TPbReq) => TCoreReq,
    handler: (params: TCoreReq, ctx: ServerCallContext) => Promise<TCoreRes>,
    converter: (res: TCoreRes) => TPbRes
  ): Promise<void> => {
    try {
      const context = await _buildContext(call, options.userBuilder, requestHandler);
      const coreRequest = parser(call.request);
      const result = await handler(coreRequest, context);
      call.sendMetadata(buildMetadata(context));
      callback(null, converter(result));
    } catch (error) {
      callback(mapToError(error), null);
    }
  };

  /**
   * Helper to wrap server-streaming calls with shared context/metadata
   * /error logic. Mirrors {@link wrapUnary} but for server-streaming
   * RPCs (`sendStreamingMessage`, `taskSubscription`).
   */
  const wrapStreaming = async <TPbReq, TPbRes, TCoreReq, TCoreRes>(
    call: grpc.ServerWritableStream<TPbReq, TPbRes>,
    parser: (req: TPbReq) => TCoreReq,
    handler: (params: TCoreReq, ctx: ServerCallContext) => AsyncGenerator<TCoreRes>,
    converter: (res: TCoreRes) => TPbRes
  ): Promise<void> => {
    try {
      const context = await _buildContext(call, options.userBuilder, requestHandler);
      const coreRequest = parser(call.request);
      const stream = handler(coreRequest, context);
      call.sendMetadata(buildMetadata(context));
      for await (const responsePart of stream) {
        call.write(converter(responsePart));
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
        _parseSendMessageRequest,
        requestHandler.sendMessage.bind(requestHandler),
        _serializeSendMessageResult
      );
    },

    sendStreamingMessage(
      call: grpc.ServerWritableStream<SendMessageRequest, StreamResponse>
    ): Promise<void> {
      return wrapStreaming(
        call,
        _parseSendMessageRequest,
        requestHandler.sendMessageStream.bind(requestHandler),
        _serializeStreamResponse
      );
    },

    taskSubscription(
      call: grpc.ServerWritableStream<TaskSubscriptionRequest, StreamResponse>
    ): Promise<void> {
      return wrapStreaming(
        call,
        _parseTaskSubscriptionRequest,
        requestHandler.resubscribe.bind(requestHandler),
        _serializeStreamResponse
      );
    },

    getTask(
      call: grpc.ServerUnaryCall<GetTaskRequest, Task>,
      callback: grpc.sendUnaryData<Task>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        _parseGetTaskRequest,
        requestHandler.getTask.bind(requestHandler),
        _serializeTask
      );
    },

    cancelTask(
      call: grpc.ServerUnaryCall<CancelTaskRequest, Task>,
      callback: grpc.sendUnaryData<Task>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        _parseCancelTaskRequest,
        requestHandler.cancelTask.bind(requestHandler),
        _serializeTask
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
        _parseCreateTaskPushNotificationConfigRequest,
        requestHandler.createTaskPushNotificationConfig.bind(requestHandler),
        _serializeTaskPushNotificationConfig
      );
    },

    getTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<GetTaskPushNotificationConfigRequest, TaskPushNotificationConfig>,
      callback: grpc.sendUnaryData<TaskPushNotificationConfig>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        _parseGetTaskPushNotificationConfigRequest,
        requestHandler.getTaskPushNotificationConfig.bind(requestHandler),
        _serializeTaskPushNotificationConfig
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
        _parseListTaskPushNotificationConfigRequest,
        requestHandler.listTaskPushNotificationConfigs.bind(requestHandler),
        _serializeListTaskPushNotificationConfigResponse
      );
    },

    deleteTaskPushNotificationConfig(
      call: grpc.ServerUnaryCall<DeleteTaskPushNotificationConfigRequest, Empty>,
      callback: grpc.sendUnaryData<Empty>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        _parseDeleteTaskPushNotificationConfigRequest,
        requestHandler.deleteTaskPushNotificationConfig.bind(requestHandler),
        () => ({})
      );
    },

    getAgentCard(
      call: grpc.ServerUnaryCall<GetAgentCardRequest, AgentCard>,
      callback: grpc.sendUnaryData<AgentCard>
    ): Promise<void> {
      return wrapUnary(
        call,
        callback,
        _parseGetAgentCardRequest,
        (params, ctx) => requestHandler.getAuthenticatedExtendedAgentCard(params, ctx),
        (card) => ToProto.agentCard(toCompatAgentCard(card))
      );
    },
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

// ----- Request parsers (v0.3 pb -> v1.0 proto via v0.3 JSON) -----

/**
 * Wraps a v0.3 JSON-shaped params payload in the minimal v0.3 JSON-RPC
 * envelope expected by `toCore*Request` translators (which were authored
 * for the JSON-RPC path). The `id`/`method` fields are placeholders since
 * gRPC has no envelope on the wire.
 */
function _envelope<T>(
  params: T,
  method: string
): { id: 0; jsonrpc: '2.0'; method: string; params: T } {
  return { id: 0, jsonrpc: '2.0', method, params };
}

function _parseSendMessageRequest(req: SendMessageRequest) {
  const params = FromProto.messageSendParams(req);
  return toCoreSendMessageRequest(_envelope(params, 'message/send') as legacy.SendMessageRequest);
}

function _parseTaskSubscriptionRequest(req: TaskSubscriptionRequest) {
  return toCoreSubscribeToTaskRequest(
    _envelope(
      { id: extractTaskId(req.name) },
      'tasks/resubscribe'
    ) as legacy.TaskResubscriptionRequest
  );
}

function _parseGetTaskRequest(req: GetTaskRequest) {
  const params = FromProto.taskQueryParams(req);
  return toCoreGetTaskRequest(_envelope(params, 'tasks/get') as legacy.GetTaskRequest);
}

function _parseCancelTaskRequest(req: CancelTaskRequest) {
  const params = FromProto.taskIdParams(req);
  return toCoreCancelTaskRequest(_envelope(params, 'tasks/cancel') as legacy.CancelTaskRequest);
}

function _parseCreateTaskPushNotificationConfigRequest(
  req: CreateTaskPushNotificationConfigRequest
) {
  const params = FromProto.createTaskPushNotificationConfig(req);
  return toCoreCreateTaskPushNotificationConfigRequest(
    _envelope(
      params,
      'tasks/pushNotificationConfig/set'
    ) as legacy.SetTaskPushNotificationConfigRequest
  );
}

function _parseGetTaskPushNotificationConfigRequest(req: GetTaskPushNotificationConfigRequest) {
  const params = FromProto.getTaskPushNotificationConfigParams(req);
  return toCoreGetTaskPushNotificationConfigRequest(
    _envelope(
      params,
      'tasks/pushNotificationConfig/get'
    ) as legacy.GetTaskPushNotificationConfigRequest
  );
}

function _parseListTaskPushNotificationConfigRequest(req: ListTaskPushNotificationConfigRequest) {
  const params = FromProto.listTaskPushNotificationConfigParams(req);
  return toCoreListTaskPushNotificationConfigsRequest(
    _envelope(
      params,
      'tasks/pushNotificationConfig/list'
    ) as legacy.ListTaskPushNotificationConfigRequest
  );
}

function _parseDeleteTaskPushNotificationConfigRequest(
  req: DeleteTaskPushNotificationConfigRequest
) {
  // v0.3 DeleteTaskPushNotificationConfigRequest uses `name=tasks/{id}/pushNotificationConfigs/{cfg}`
  // but the JSON-RPC params are `{ id, pushNotificationConfigId }`. Build the
  // JSON shape manually since `FromProto.deleteTaskPushNotificationConfigParams`
  // would do the same.
  const { taskId, configId } = extractTaskAndPushNotificationConfigId(req.name);
  return toCoreDeleteTaskPushNotificationConfigRequest(
    _envelope(
      { id: taskId, pushNotificationConfigId: configId },
      'tasks/pushNotificationConfig/delete'
    ) as legacy.DeleteTaskPushNotificationConfigRequest
  );
}

function _parseGetAgentCardRequest(_req: GetAgentCardRequest) {
  return toCoreGetExtendedAgentCardRequest(
    _envelope(
      {},
      'agent/getAuthenticatedExtendedCard'
    ) as unknown as legacy.GetAuthenticatedExtendedCardRequest
  );
}

// ----- Response serializers (v1.0 proto -> v0.3 pb via v0.3 JSON) -----

function _serializeSendMessageResult(result: V1Message | V1Task): SendMessageResponse {
  // `requestHandler.sendMessage` returns either a Message or a Task (v1.0
  // proto). Translate via the v0.3 message/task translators and then run
  // `ToProto.messageSendResult` to put the result back into v0.3 pb shape.
  if (!result) {
    throw new InvalidAgentResponseError('Invalid SendMessage result from request handler');
  }
  const compat: legacy.Message | legacy.Task =
    'messageId' in result ? toCompatMessage(result as V1Message) : toCompatTask(result as V1Task);
  const response = ToProto.messageSendResult(compat);
  if (!response) {
    throw new InvalidAgentResponseError('Invalid SendMessage result from request handler');
  }
  return response;
}

function _serializeStreamResponse(event: V1StreamResponse): StreamResponse {
  // v1.0 `StreamResponse` carries a oneof `payload` matching v0.3's
  // `StreamResponse.payload` 1:1 modulo casing (`msg` vs `message`).
  // For each case, translate the v1.0 proto value to v0.3 JSON via the
  // `toCompat*` translators, then re-encode into the v0.3 pb wire
  // representation via `ToProto.messageStreamResult`.
  if (!event || !event.payload) {
    throw new InvalidAgentResponseError('StreamResponse missing payload');
  }
  const payload = event.payload;
  switch (payload.$case) {
    case 'message':
      return ToProto.messageStreamResult(toCompatMessage(payload.value));
    case 'task':
      return ToProto.messageStreamResult(toCompatTask(payload.value));
    case 'statusUpdate':
      return ToProto.messageStreamResult(toCompatTaskStatusUpdateEvent(payload.value));
    case 'artifactUpdate':
      return ToProto.messageStreamResult(toCompatTaskArtifactUpdateEvent(payload.value));
    default:
      throw new InvalidAgentResponseError('Unknown StreamResponse payload case');
  }
}

function _serializeTask(task: V1Task): Task {
  return ToProto.task(toCompatTask(task));
}

function _serializeTaskPushNotificationConfig(
  cfg: V1TaskPushNotificationConfig
): TaskPushNotificationConfig {
  return ToProto.taskPushNotificationConfig(toCompatTaskPushNotificationConfig(cfg));
}

function _serializeListTaskPushNotificationConfigResponse(
  response: V1ListTaskPushNotificationConfigsResponse
): ListTaskPushNotificationConfigResponse {
  // v0.3 has no pagination on this endpoint, so `nextPageToken` is dropped
  // on the way out. v1.0 callers that need it should use the v1.0
  // transport.
  if (!response || !response.configs) {
    throw new InvalidAgentResponseError(
      'Invalid ListTaskPushNotificationConfigs result from request handler'
    );
  }
  return ToProto.listTaskPushNotificationConfig(
    response.configs.map((cfg) => toCompatTaskPushNotificationConfig(cfg))
  );
}

// ----- Error mapping -----

/**
 * Maps an error to a gRPC error with v1.0-style status details.
 *
 * Uses an `instanceof` chain (matching the v1.0 `grpcService`) so that
 * user-defined subclasses of A2A error types — e.g.
 * `class MyTaskNotFound extends TaskNotFoundError {}` — resolve to the
 * correct gRPC status of the nearest base class.
 *
 * Also attaches a `google.rpc.ErrorInfo` detail in
 * `grpc-status-details-bin`: v0.3 clients that don't decode binary status
 * trailers ignore it harmlessly, while v1.0-aware clients connecting to
 * a v0.3 server still get the enriched §10.6 error model.
 */
const mapToError = (error: unknown): Partial<grpc.ServiceError> => {
  let code = grpc.status.UNKNOWN;
  if (error instanceof TaskNotFoundError) code = grpc.status.NOT_FOUND;
  else if (error instanceof TaskNotCancelableError) code = grpc.status.FAILED_PRECONDITION;
  else if (error instanceof PushNotificationNotSupportedError)
    code = grpc.status.FAILED_PRECONDITION;
  else if (error instanceof UnsupportedOperationError) code = grpc.status.FAILED_PRECONDITION;
  else if (error instanceof ContentTypeNotSupportedError) code = grpc.status.INVALID_ARGUMENT;
  else if (error instanceof InvalidAgentResponseError) code = grpc.status.INTERNAL;
  else if (error instanceof ExtendedAgentCardNotConfiguredError)
    code = grpc.status.FAILED_PRECONDITION;
  else if (error instanceof ExtensionSupportRequiredError) code = grpc.status.FAILED_PRECONDITION;
  else if (error instanceof VersionNotSupportedError) code = grpc.status.FAILED_PRECONDITION;
  else if (error instanceof RequestMalformedError) code = grpc.status.INVALID_ARGUMENT;
  else if (error instanceof GenericError) code = grpc.status.INTERNAL;

  const message = error instanceof Error ? error.message : 'Internal server error';

  const result: Partial<grpc.ServiceError> = {
    code,
    details: message,
  };

  if (error instanceof Error) {
    const errorMetadata = buildGrpcErrorMetadata(code, message, error);
    if (errorMetadata) {
      result.metadata = errorMetadata;
    }
  }

  return result;
};

// ----- Context / metadata helpers -----

const _buildContext = async (
  call: grpc.ServerUnaryCall<unknown, unknown> | grpc.ServerWritableStream<unknown, unknown>,
  userBuilder: UserBuilder,
  requestHandler: A2ARequestHandler
): Promise<ServerCallContext> => {
  const user = await userBuilder(call);
  // v0.3 used the `X-A2A-Extensions` header; v1.0 dropped the `X-` prefix.
  // Accept both so a v0.3-on-v0.3 path and a v1.0-on-v0.3 path both work.
  // gRPC metadata keys are normalized to lowercase per §10.2.
  const extensionHeaders = [
    ...call.metadata.get(HTTP_EXTENSION_HEADER.toLowerCase()),
    ...call.metadata.get(LEGACY_HTTP_EXTENSION_HEADER.toLowerCase()),
  ];
  const extensionString = extensionHeaders.map((v) => v.toString()).join(',');

  // gRPC metadata keys are normalized to lowercase per gRPC conventions (§10.2).
  const versionHeaders = call.metadata.get(A2A_VERSION_HEADER.toLowerCase());
  const requestedVersion = versionHeaders.length > 0 ? versionHeaders[0].toString() : undefined;

  // v0.3 has no tenant concept on the wire; leave it undefined.
  const context = new ServerCallContext({
    requestedExtensions: Extensions.parseServiceParameter(extensionString),
    user,
    requestedVersion,
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

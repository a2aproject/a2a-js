/**
 * v0.3 gRPC service handler. Implements the v0.3 `A2AServiceServer`
 * interface by dispatching to a v1.0 `A2ARequestHandler`, with proto
 * shape translation on both directions. Register alongside the v1.0
 * `grpcService` on the same `Server` — both share the
 * `a2a.v1.A2AService` package name but use different service
 * descriptors, so they coexist without collisions.
 *
 * Errors are mapped through an `instanceof` chain and enriched with
 * `google.rpc.ErrorInfo` in `grpc-status-details-bin`. v0.3 clients
 * that don't decode binary status ignore it; v1.0-aware clients get
 * typed errors.
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
import { UserBuilder } from './common.js';
import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER } from '../../../../constants.js';
import { LEGACY_HTTP_EXTENSION_HEADER } from '../../constants.js';
import { A2AError, InvalidAgentResponseError, isJsonRpcError } from '../../../../errors/index.js';
import {
  buildGrpcErrorMetadata,
  GRPC_STATUS_CODE,
  grpcStatusFor,
} from '../../../../errors/grpc/index.js';
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

/** Same shape as v1.0 `GrpcServiceOptions`. */
export interface LegacyGrpcServiceOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
}

/**
 * Creates a v0.3 gRPC service handler. Register on a `grpc.Server`
 * against the `LegacyA2AService` descriptor.
 *
 * @example
 * ```ts
 * server.addService(A2AService,       grpcService({ requestHandler, userBuilder }));
 * server.addService(LegacyA2AService, legacyGrpcService({ requestHandler, userBuilder }));
 * ```
 */
export function legacyGrpcService(options: LegacyGrpcServiceOptions): A2AServiceServer {
  const requestHandler = options.requestHandler;

  // `parser` maps v0.3 pb → whatever the v1.0 handler expects;
  // `converter` maps the v1.0 result back to the v0.3 pb response.
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

  // Streaming counterpart to `wrapUnary` for `sendStreamingMessage` and
  // `taskSubscription`.
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

// Request parsers (v0.3 pb → v1.0 proto via v0.3 JSON).

// Wraps a v0.3 JSON-shaped params payload in the minimal envelope expected
// by `toCore*Request` (which was authored for the JSON-RPC path). `id` and
// `method` are placeholders since gRPC has no envelope on the wire.
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
  // v0.3 uses `name=tasks/{id}/pushNotificationConfigs/{cfg}`; the JSON-RPC
  // params are `{ id, pushNotificationConfigId }`. Build the JSON shape
  // manually.
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

// Response serializers (v1.0 proto → v0.3 pb via v0.3 JSON).

function _serializeSendMessageResult(result: V1Message | V1Task): SendMessageResponse {
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
  // v1.0's payload oneof matches v0.3's 1:1 modulo casing (`msg` vs
  // `message`).
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
  // v0.3 has no pagination here, so `nextPageToken` is dropped.
  if (!response || !response.configs) {
    throw new InvalidAgentResponseError(
      'Invalid ListTaskPushNotificationConfigs result from request handler'
    );
  }
  return ToProto.listTaskPushNotificationConfig(
    response.configs.map((cfg) => toCompatTaskPushNotificationConfig(cfg))
  );
}

// Error mapping.

// JSON-RPC envelope code -> gRPC status, used only for `JsonRpc*Error`
// instances whose `envelopeCode` overrides the semantic default (e.g.
// `METHOD_NOT_FOUND` -> UNIMPLEMENTED, not the semantic
// `UnsupportedOperationError` -> FAILED_PRECONDITION).
const LEGACY_CODE_TO_GRPC_STATUS: Readonly<Record<number, grpc.status>> = {
  [-32700]: grpc.status.INVALID_ARGUMENT, // Parse error
  [-32600]: grpc.status.INVALID_ARGUMENT, // Invalid Request
  [-32601]: grpc.status.UNIMPLEMENTED, // Method not found
  [-32603]: grpc.status.INTERNAL, // Internal error
};

const mapToError = (error: unknown): Partial<grpc.ServiceError> => {
  let code: number;
  if (isJsonRpcError(error) && LEGACY_CODE_TO_GRPC_STATUS[error.envelopeCode] !== undefined) {
    code = LEGACY_CODE_TO_GRPC_STATUS[error.envelopeCode];
  } else if (error instanceof A2AError) {
    code = grpcStatusFor(error);
  } else {
    code = GRPC_STATUS_CODE.UNKNOWN;
  }
  const message = error instanceof Error ? error.message : 'Internal server error';
  const result: Partial<grpc.ServiceError> = { code, details: message };
  const md = buildGrpcErrorMetadata(grpc.Metadata, error);
  if (md) result.metadata = md;
  return result;
};

// Context / metadata helpers.

const _buildContext = async (
  call: grpc.ServerUnaryCall<unknown, unknown> | grpc.ServerWritableStream<unknown, unknown>,
  userBuilder: UserBuilder,
  requestHandler: A2ARequestHandler
): Promise<ServerCallContext> => {
  const user = await userBuilder(call);
  // Accept both v0.3's `X-A2A-Extensions` and v1.0's `A2A-Extensions`.
  // gRPC metadata keys are normalized to lowercase.
  const extensionHeaders = [
    ...call.metadata.get(HTTP_EXTENSION_HEADER.toLowerCase()),
    ...call.metadata.get(LEGACY_HTTP_EXTENSION_HEADER.toLowerCase()),
  ];
  const extensionString = extensionHeaders.map((v) => v.toString()).join(',');

  const versionHeaders = call.metadata.get(A2A_VERSION_HEADER.toLowerCase());
  const requestedVersion = versionHeaders.length > 0 ? versionHeaders[0].toString() : undefined;

  const context = new ServerCallContext({
    requestedExtensions: Extensions.parseServiceParameter(extensionString),
    user,
    requestedVersion,
  });

  const agentCard = await requestHandler.getAgentCard();
  // Strict per-interface check: the card must declare a GRPC interface
  // at `protocolVersion: '0.3'` (manually or via
  // `duplicateInterfacesForLegacy`).
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

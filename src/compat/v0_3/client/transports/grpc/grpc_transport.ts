/**
 * v0.3 gRPC client transport (compat layer).
 *
 * Implements the v1.0 {@link Transport} interface but speaks the v0.3 gRPC
 * wire format. Each method translates the v1.0 proto request to the v0.3
 * JSON shape (via the `toCompat*Request` helpers in
 * `../../../translate/requests.js`) and then to the v0.3 protobuf wire
 * shape (via {@link ToProto} from `../../../types/converters/to_proto.js`),
 * issues the gRPC call against the v0.3 service descriptor, then runs the
 * reverse chain on the response: v0.3 pb -> v0.3 JSON (via
 * {@link FromProto}) -> v1.0 proto (via the `toCore*` helpers).
 *
 * Shares `protocolName === 'GRPC'` with the v1.0 transport. The core-side
 * {@link GrpcTransportFactory} inspects the matched
 * `AgentInterface.protocolVersion` when `legacyCompat: { enabled: true }`
 * is set and instantiates this class when the version falls in
 * `[0.3, 1.0)`, so installing the default `GrpcTransportFactory` with the
 * flag transparently covers both protocol versions.
 *
 * v0.3 gRPC wire-format differences from v1.0:
 *   - Method names differ: `getAgentCard` (v0.3) vs `getExtendedAgentCard`
 *     (v1.0); `taskSubscription` (v0.3) vs `subscribeToTask` (v1.0);
 *     `listTaskPushNotificationConfig` (v0.3, singular) vs
 *     `listTaskPushNotificationConfigs` (v1.0, plural).
 *   - Resource identifiers travel as URI-style names
 *     (`tasks/{id}`, `tasks/{id}/pushNotificationConfigs/{cfg}`) instead of
 *     the v1.0 dedicated request fields.
 *   - `CreateTaskPushNotificationConfigRequest` wraps the config under
 *     `{ parent, configId, config }` instead of carrying the
 *     `TaskPushNotificationConfig` as the request body directly.
 *   - The v0.3 server response payload `SendMessageResponse.payload.$case`
 *     uses `msg` (not `message`).
 *   - `listTasks` has no v0.3 equivalent at all — calling it throws
 *     {@link UnsupportedOperationError} synchronously without issuing any
 *     RPC.
 *   - Error mapping uses the §10.6 enriched error model: it parses
 *     `google.rpc.ErrorInfo` from `grpc-status-details-bin` if present
 *     (the v0.3 `legacyGrpcService` in this SDK emits it), and otherwise
 *     returns a generic `Error` preserving the original gRPC code and
 *     details.
 */

import * as grpc from '@grpc/grpc-js';
import { TransportProtocolName } from '../../../../../core.js';
import {
  A2A_REASON_TO_ERROR_CLASS,
  ERROR_INFO_TYPE,
  UnsupportedOperationError,
} from '../../../../../errors.js';
import { A2A_LEGACY_PROTOCOL_VERSION } from '../../../../../constants.js';
import type { SendMessageResult } from '../../../../../index.js';
import type { RequestOptions } from '../../../../../client/multitransport-client.js';
import type { Transport } from '../../../../../client/transports/transport.js';
import { decodeErrorInfo, decodeStatus } from '../../../../../server/grpc/error_details.js';
import {
  A2AServiceClient,
  type CreateTaskPushNotificationConfigRequest,
  type DeleteTaskPushNotificationConfigRequest,
  type GetAgentCardRequest,
  type GetTaskPushNotificationConfigRequest,
  type GetTaskRequest,
  type ListTaskPushNotificationConfigRequest,
  type ListTaskPushNotificationConfigResponse,
  type SendMessageRequest,
  type SendMessageResponse,
  type StreamResponse,
  type Task,
  type TaskPushNotificationConfig,
  type TaskSubscriptionRequest,
  type AgentCard,
} from '../../../grpc/pb/a2a.js';
import type {
  AgentCard as V1AgentCard,
  CancelTaskRequest as V1CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest as V1DeleteTaskPushNotificationConfigRequest,
  GetExtendedAgentCardRequest as V1GetExtendedAgentCardRequest,
  GetTaskPushNotificationConfigRequest as V1GetTaskPushNotificationConfigRequest,
  GetTaskRequest as V1GetTaskRequest,
  ListTaskPushNotificationConfigsRequest as V1ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse as V1ListTaskPushNotificationConfigsResponse,
  ListTasksRequest as V1ListTasksRequest,
  ListTasksResponse as V1ListTasksResponse,
  SendMessageRequest as V1SendMessageRequest,
  StreamResponse as V1StreamResponse,
  SubscribeToTaskRequest as V1SubscribeToTaskRequest,
  Task as V1Task,
  TaskPushNotificationConfig as V1TaskPushNotificationConfig,
} from '../../../../../types/pb/a2a.js';
import { FromProto } from '../../../types/converters/from_proto.js';
import { ToProto } from '../../../types/converters/to_proto.js';
import {
  toCompatCancelTaskRequest,
  toCompatDeleteTaskPushNotificationConfigRequest,
  toCompatGetTaskPushNotificationConfigRequest,
  toCompatGetTaskRequest,
  toCompatListTaskPushNotificationConfigRequest,
  toCompatSendMessageRequest,
  toCompatSetTaskPushNotificationConfigRequest,
  toCompatTaskResubscriptionRequest,
  toCoreAgentCard,
  toCoreListTaskPushNotificationConfigsResponse,
  toCoreMessage,
  toCoreStreamResponse,
  toCoreTask,
  toCoreTaskPushNotificationConfig,
} from '../../../translate/index.js';
import type * as legacy from '../../../types/types.js';

const PROTOCOL_NAME: TransportProtocolName = 'GRPC';

type GrpcUnaryCall<TReq, TRes> = (
  request: TReq,
  metadata: grpc.Metadata,
  options: Partial<grpc.CallOptions>,
  callback: (error: grpc.ServiceError | null, response: TRes) => void
) => grpc.ClientUnaryCall;

type GrpcStreamCall<TReq, TRes> = (
  request: TReq,
  metadata?: grpc.Metadata,
  options?: Partial<grpc.CallOptions>
) => grpc.ClientReadableStream<TRes>;

export interface LegacyGrpcTransportOptions {
  endpoint: string;
  grpcChannelCredentials?: grpc.ChannelCredentials;
  grpcCallOptions?: Partial<grpc.CallOptions>;
}

/**
 * v0.3 gRPC client transport. See the file-level comment for the overall
 * design.
 */
export class LegacyGrpcTransport implements Transport {
  private readonly grpcCallOptions?: Partial<grpc.CallOptions>;
  private readonly grpcClient: A2AServiceClient;
  /**
   * Monotonic counter for synthetic JSON-RPC request IDs used by the
   * `toCompat*Request` translators. The values never appear on the v0.3
   * gRPC wire (gRPC carries no envelope); we use the counter for parity
   * with the v0.3 JSON-RPC transport in case any translator becomes
   * id-sensitive in the future.
   */
  private requestIdCounter: number = 1;

  constructor(options: LegacyGrpcTransportOptions) {
    this.grpcCallOptions = options.grpcCallOptions;
    this.grpcClient = new A2AServiceClient(
      options.endpoint,
      options.grpcChannelCredentials ?? grpc.credentials.createInsecure()
    );
  }

  get protocolName(): string {
    return PROTOCOL_NAME;
  }

  get protocolVersion(): string {
    return A2A_LEGACY_PROTOCOL_VERSION;
  }

  async getExtendedAgentCard(
    params: V1GetExtendedAgentCardRequest,
    options?: RequestOptions
  ): Promise<V1AgentCard> {
    const pbReq = ToProto.getAgentCardRequest();
    // The v0.3 RPC is `GetAgentCard` (no params).
    void params;
    return this._sendGrpcRequest<GetAgentCardRequest, AgentCard, V1AgentCard>(
      'getAgentCard',
      pbReq,
      options,
      this.grpcClient.getAgentCard.bind(this.grpcClient),
      (card) => toCoreAgentCard(FromProto.agentCard(card))
    );
  }

  async sendMessage(
    params: V1SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const legacyParams = toCompatSendMessageRequest(params, this.requestIdCounter++).params;
    const pbReq = ToProto.messageSendParams(legacyParams);
    return this._sendGrpcRequest<SendMessageRequest, SendMessageResponse, SendMessageResult>(
      'sendMessage',
      pbReq,
      options,
      this.grpcClient.sendMessage.bind(this.grpcClient),
      LegacyGrpcTransport._parseSendMessageResult
    );
  }

  async *sendMessageStream(
    params: V1SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
    const legacyParams = toCompatSendMessageRequest(params, this.requestIdCounter++).params;
    const pbReq = ToProto.messageSendParams(legacyParams);
    yield* this._sendGrpcStreamingRequest<SendMessageRequest>(
      'sendStreamingMessage',
      pbReq,
      options,
      this.grpcClient.sendStreamingMessage.bind(this.grpcClient)
    );
  }

  async createTaskPushNotificationConfig(
    params: V1TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<V1TaskPushNotificationConfig> {
    const legacyParams = toCompatSetTaskPushNotificationConfigRequest(
      params,
      this.requestIdCounter++
    ).params;
    const pbReq = ToProto.taskPushNotificationConfigCreate(legacyParams);
    return this._sendGrpcRequest<
      CreateTaskPushNotificationConfigRequest,
      TaskPushNotificationConfig,
      V1TaskPushNotificationConfig
    >(
      'createTaskPushNotificationConfig',
      pbReq,
      options,
      this.grpcClient.createTaskPushNotificationConfig.bind(this.grpcClient),
      (pb) => toCoreTaskPushNotificationConfig(FromProto.taskPushNotificationConfig(pb))
    );
  }

  async getTaskPushNotificationConfig(
    params: V1GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<V1TaskPushNotificationConfig> {
    const legacyParams = toCompatGetTaskPushNotificationConfigRequest(
      params,
      this.requestIdCounter++
    ).params;
    // `legacyParams` may be either `GetTaskPushNotificationConfigParams`
    // (with `pushNotificationConfigId`) or `TaskIdParams1` (bare `id`).
    // `ToProto.getTaskPushNotificationConfigParams` accepts the former
    // and treats a missing `pushNotificationConfigId` as `''`.
    const pbReq = ToProto.getTaskPushNotificationConfigParams({
      id: legacyParams.id,
      pushNotificationConfigId:
        'pushNotificationConfigId' in legacyParams
          ? legacyParams.pushNotificationConfigId
          : undefined,
    });
    return this._sendGrpcRequest<
      GetTaskPushNotificationConfigRequest,
      TaskPushNotificationConfig,
      V1TaskPushNotificationConfig
    >(
      'getTaskPushNotificationConfig',
      pbReq,
      options,
      this.grpcClient.getTaskPushNotificationConfig.bind(this.grpcClient),
      (pb) => toCoreTaskPushNotificationConfig(FromProto.taskPushNotificationConfig(pb))
    );
  }

  async listTaskPushNotificationConfig(
    params: V1ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<V1ListTaskPushNotificationConfigsResponse> {
    const legacyParams = toCompatListTaskPushNotificationConfigRequest(
      params,
      this.requestIdCounter++
    ).params;
    const pbReq = ToProto.listTaskPushNotificationConfigParams(legacyParams);
    return this._sendGrpcRequest<
      ListTaskPushNotificationConfigRequest,
      ListTaskPushNotificationConfigResponse,
      V1ListTaskPushNotificationConfigsResponse
    >(
      'listTaskPushNotificationConfig',
      pbReq,
      options,
      this.grpcClient.listTaskPushNotificationConfig.bind(this.grpcClient),
      (pb) =>
        toCoreListTaskPushNotificationConfigsResponse({
          id: null,
          jsonrpc: '2.0',
          result: FromProto.listTaskPushNotificationConfig(pb),
        })
    );
  }

  async deleteTaskPushNotificationConfig(
    params: V1DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void> {
    const legacyParams = toCompatDeleteTaskPushNotificationConfigRequest(
      params,
      this.requestIdCounter++
    ).params;
    const pbReq = ToProto.deleteTaskPushNotificationConfigParams(legacyParams);
    await this._sendGrpcRequest<DeleteTaskPushNotificationConfigRequest, unknown, void>(
      'deleteTaskPushNotificationConfig',
      pbReq,
      options,
      this.grpcClient.deleteTaskPushNotificationConfig.bind(this.grpcClient),
      () => undefined
    );
  }

  async getTask(params: V1GetTaskRequest, options?: RequestOptions): Promise<V1Task> {
    const legacyParams = toCompatGetTaskRequest(params, this.requestIdCounter++).params;
    const pbReq = ToProto.taskQueryParams(legacyParams);
    return this._sendGrpcRequest<GetTaskRequest, Task, V1Task>(
      'getTask',
      pbReq,
      options,
      this.grpcClient.getTask.bind(this.grpcClient),
      (pb) => toCoreTask(FromProto.task(pb))
    );
  }

  async cancelTask(params: V1CancelTaskRequest, options?: RequestOptions): Promise<V1Task> {
    const legacyParams = toCompatCancelTaskRequest(params, this.requestIdCounter++).params;
    const pbReq = ToProto.cancelTaskRequest(legacyParams);
    return this._sendGrpcRequest<
      import('../../../types/pb/a2a.js').CancelTaskRequest,
      Task,
      V1Task
    >('cancelTask', pbReq, options, this.grpcClient.cancelTask.bind(this.grpcClient), (pb) =>
      toCoreTask(FromProto.task(pb))
    );
  }

  /**
   * `tasks/list` has no equivalent in v0.3 gRPC (the v0.3 proto has no
   * `ListTasks` RPC at all). Throws synchronously without issuing any
   * RPC, consistent with the v0.3 JSON-RPC and REST compat transports.
   */
  async listTasks(
    _params: V1ListTasksRequest,
    _options?: RequestOptions
  ): Promise<V1ListTasksResponse> {
    throw new UnsupportedOperationError('tasks/list has no equivalent in v0.3 gRPC');
  }

  async *resubscribeTask(
    params: V1SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
    const legacyParams = toCompatTaskResubscriptionRequest(params, this.requestIdCounter++).params;
    const pbReq = ToProto.taskIdParams(legacyParams);
    yield* this._sendGrpcStreamingRequest<TaskSubscriptionRequest>(
      'taskSubscription',
      pbReq,
      options,
      this.grpcClient.taskSubscription.bind(this.grpcClient)
    );
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private async _sendGrpcRequest<TReq, TRes, TResponse>(
    method: string,
    request: TReq,
    options: RequestOptions | undefined,
    call: GrpcUnaryCall<TReq, TRes>,
    converter: (res: TRes) => TResponse
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      let onAbort: (() => void) | undefined;

      const clientCall = call(
        request,
        this._buildMetadata(options),
        this.grpcCallOptions ?? {},
        (error, response) => {
          if (options?.signal && onAbort) {
            options.signal.removeEventListener('abort', onAbort);
          }
          if (error) {
            return reject(LegacyGrpcTransport._mapToError(error, method));
          }
          try {
            resolve(converter(response));
          } catch (err) {
            reject(err as Error);
          }
        }
      );

      if (options?.signal) {
        if (options.signal.aborted) {
          clientCall.cancel();
        } else {
          onAbort = () => clientCall.cancel();
          options.signal.addEventListener('abort', onAbort);
        }
      }
    });
  }

  private async *_sendGrpcStreamingRequest<TReq>(
    method: 'sendStreamingMessage' | 'taskSubscription',
    request: TReq,
    options: RequestOptions | undefined,
    call: GrpcStreamCall<TReq, StreamResponse>
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
    const streamResponse = call(request, this._buildMetadata(options), this.grpcCallOptions ?? {});

    let onAbort: (() => void) | undefined;
    if (options?.signal) {
      if (options.signal.aborted) {
        streamResponse.cancel();
      } else {
        onAbort = () => streamResponse.cancel();
        options.signal.addEventListener('abort', onAbort);
      }
    }

    try {
      for await (const pbEvent of streamResponse) {
        yield LegacyGrpcTransport._toCoreStreamResponse(pbEvent as StreamResponse);
      }
    } catch (error) {
      if (LegacyGrpcTransport._isServiceError(error)) {
        throw LegacyGrpcTransport._mapToError(error, method);
      }
      throw new Error(`GRPC error for ${String(method)}!`, { cause: error });
    } finally {
      if (options?.signal && onAbort) {
        options.signal.removeEventListener('abort', onAbort);
      }
      streamResponse.cancel();
    }
  }

  private static _isServiceError(error: unknown): error is grpc.ServiceError {
    return typeof error === 'object' && error !== null && 'code' in error;
  }

  private _buildMetadata(options: RequestOptions | undefined): grpc.Metadata {
    const metadata = new grpc.Metadata();
    if (options?.serviceParameters) {
      for (const [key, value] of Object.entries(options.serviceParameters)) {
        metadata.set(key, value);
      }
    }
    return metadata;
  }

  /**
   * Parses the `result` of a v0.3 `sendMessage` response (post-FromProto)
   * into a v1.0 `SendMessageResult`. v0.3 uses the `kind: 'task'|'message'`
   * discriminator we pick on.
   */
  private static _parseSendMessageResult(response: SendMessageResponse): SendMessageResult {
    const result = FromProto.sendMessageResult(response);
    if (result.kind === 'task') {
      return toCoreTask(result);
    }
    return toCoreMessage(result);
  }

  /**
   * Translates a v0.3 pb `StreamResponse` into a v1.0 proto
   * `StreamResponse` by going through the v0.3 JSON shape first
   * (`FromProto.messageStreamResult`) and then through
   * `toCoreStreamResponse` via a synthetic JSON-RPC success envelope (the
   * translator was authored for the JSON-RPC path).
   */
  private static _toCoreStreamResponse(pb: StreamResponse): V1StreamResponse {
    const result = FromProto.messageStreamResult(pb);
    const envelope: legacy.SendStreamingMessageSuccessResponse = {
      id: null,
      jsonrpc: '2.0',
      result,
    };
    return toCoreStreamResponse(envelope);
  }

  /**
   * Maps a gRPC `ServiceError` to a typed SDK error.
   *
   * Uses the §10.6 enriched error model: parses `google.rpc.ErrorInfo`
   * from `grpc-status-details-bin` metadata and looks the `reason` code
   * up in {@link A2A_REASON_TO_ERROR_CLASS} to produce a typed SDK error.
   * The v0.3 `legacyGrpcService` (in this SDK) emits ErrorInfo, so
   * v0.3-on-v0.3 SDK paths still get typed errors. For servers that
   * don't include ErrorInfo (e.g. third-party non-A2A v0.3 servers),
   * returns a generic `Error` preserving the original gRPC code and
   * details.
   */
  private static _mapToError(error: grpc.ServiceError, method?: string): Error {
    const fromErrorInfo = LegacyGrpcTransport._mapFromErrorInfo(error);
    if (fromErrorInfo) return fromErrorInfo;

    const methodContext = method ? ' for ' + method : '';
    return new Error('gRPC error' + methodContext + ': ' + error.code + ' ' + error.details, {
      cause: error,
    });
  }

  private static _mapFromErrorInfo(error: grpc.ServiceError): Error | undefined {
    const bin = error.metadata?.get('grpc-status-details-bin');
    if (!bin || bin.length === 0) return undefined;

    const raw = bin[0];
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'binary');

    const status = decodeStatus(buffer);

    for (const detail of status.details) {
      if (detail.typeUrl === ERROR_INFO_TYPE) {
        const errorInfo = decodeErrorInfo(detail.value);

        const ErrorClass = A2A_REASON_TO_ERROR_CLASS[errorInfo.reason];
        if (!ErrorClass) return undefined;

        return new ErrorClass(error.details);
      }
    }

    return undefined;
  }
}

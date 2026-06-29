/**
 * v0.3 gRPC client transport. Implements the v1.0 `Transport` interface
 * but speaks the v0.3 gRPC wire format. Picked automatically by the
 * v1.0 `GrpcTransportFactory` when `legacyCompat: { enabled: true }`
 * matches a legacy interface.
 *
 * v0.3 differences worth noting:
 *  - Method names: `getAgentCard` / `taskSubscription` /
 *    `listTaskPushNotificationConfig` (singular).
 *  - Resource ids travel as URI names (`tasks/{id}`, …).
 *  - `SendMessageResponse.payload.$case` uses `msg`, not `message`.
 *  - `listTasks` throws synchronously — no v0.3 equivalent exists.
 *  - Errors are decoded from `grpc-status-details-bin` when present
 *    (this SDK's `legacyGrpcService` emits ErrorInfo), otherwise a
 *    generic `Error` preserving the gRPC code and details.
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

export class LegacyGrpcTransport implements Transport {
  private readonly grpcCallOptions?: Partial<grpc.CallOptions>;
  private readonly grpcClient: A2AServiceClient;
  // Synthetic IDs for the `toCompat*Request` translators. Never on the wire.
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
    // v0.3's `GetAgentCard` takes no params.
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
    // `legacyParams` may carry `pushNotificationConfigId` or just `id`.
    // The proto helper treats a missing config id as `''`.
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

  /** No `ListTasks` RPC exists in v0.3. Throws synchronously. */
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

  private static _parseSendMessageResult(response: SendMessageResponse): SendMessageResult {
    const result = FromProto.sendMessageResult(response);
    if (result.kind === 'task') {
      return toCoreTask(result);
    }
    return toCoreMessage(result);
  }

  /** v0.3 pb → v0.3 JSON → v1.0 proto via a synthetic JSON-RPC envelope. */
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
   * Decodes `google.rpc.ErrorInfo` from `grpc-status-details-bin` when
   * present (this SDK's `legacyGrpcService` emits it); otherwise returns
   * a generic `Error` preserving the gRPC code and details.
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

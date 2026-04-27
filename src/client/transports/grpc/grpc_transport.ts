import * as grpc from '@grpc/grpc-js';
import { TransportProtocolName } from '../../../core.js';
import {
  A2AServiceClient,
  TaskPushNotificationConfig,
  GetExtendedAgentCardRequest,
  ListTaskPushNotificationConfigsRequest,
  SubscribeToTaskRequest,
} from '../../../grpc/pb/a2a.js';
import { Task, AgentCard, ListTaskPushNotificationConfigsResponse } from '../../../types/pb/a2a.js';
import {
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  SendMessageRequest,
  StreamResponse,
  SendMessageResult,
  ListTasksRequest,
  ListTasksResponse,
  A2A_PROTOCOL_VERSION,
} from '../../../index.js';
import { RequestOptions } from '../../multitransport-client.js';
import { Transport, TransportFactory } from '../transport.js';
import { FromProto } from '../../../types/converters/from_proto.js';

import { A2A_REASON_TO_ERROR_CLASS, ERROR_INFO_TYPE } from '../../../errors.js';
import { decodeStatus, decodeErrorInfo } from '../../../server/grpc/error_details.js';

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

export interface GrpcTransportOptions {
  endpoint: string;
  grpcChannelCredentials?: grpc.ChannelCredentials;
  grpcCallOptions?: Partial<grpc.CallOptions>;
}

export class GrpcTransport implements Transport {
  private readonly grpcCallOptions?: Partial<grpc.CallOptions>;
  private readonly grpcClient: A2AServiceClient;

  constructor(options: GrpcTransportOptions) {
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
    return A2A_PROTOCOL_VERSION;
  }

  async getExtendedAgentCard(
    params: GetExtendedAgentCardRequest,
    options?: RequestOptions
  ): Promise<AgentCard> {
    const rpcResponse = await this._sendGrpcRequest<GetExtendedAgentCardRequest, AgentCard>(
      'getExtendedAgentCard',
      params,
      options,
      this.grpcClient.getExtendedAgentCard.bind(this.grpcClient)
    );
    return rpcResponse;
  }

  async sendMessage(
    params: SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const rpcResponse = await this._sendGrpcRequestWithConverter(
      'sendMessage',
      params,
      options,
      this.grpcClient.sendMessage.bind(this.grpcClient),
      FromProto.sendMessageResult
    );
    return rpcResponse;
  }

  async *sendMessageStream(
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    yield* this._sendGrpcStreamingRequest(
      'sendStreamingMessage',
      params,
      options,
      this.grpcClient.sendStreamingMessage.bind(this.grpcClient)
    );
  }

  async createTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendGrpcRequest<
      TaskPushNotificationConfig,
      TaskPushNotificationConfig
    >(
      'createTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.createTaskPushNotificationConfig.bind(this.grpcClient)
    );
    return rpcResponse;
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendGrpcRequest<
      GetTaskPushNotificationConfigRequest,
      TaskPushNotificationConfig
    >(
      'getTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.getTaskPushNotificationConfig.bind(this.grpcClient)
    );
    return rpcResponse;
  }

  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<ListTaskPushNotificationConfigsResponse> {
    const rpcResponse = await this._sendGrpcRequest<
      ListTaskPushNotificationConfigsRequest,
      ListTaskPushNotificationConfigsResponse
    >(
      'listTaskPushNotificationConfigs',
      params,
      options,
      this.grpcClient.listTaskPushNotificationConfigs.bind(this.grpcClient)
    );
    return rpcResponse;
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void> {
    await this._sendGrpcRequestWithConverter(
      'deleteTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.deleteTaskPushNotificationConfig.bind(this.grpcClient),
      () => {}
    );
  }

  async getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendGrpcRequest<GetTaskRequest, Task>(
      'getTask',
      params,
      options,
      this.grpcClient.getTask.bind(this.grpcClient)
    );
    return rpcResponse;
  }

  async cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendGrpcRequest<CancelTaskRequest, Task>(
      'cancelTask',
      params,
      options,
      this.grpcClient.cancelTask.bind(this.grpcClient)
    );
    return rpcResponse;
  }

  async listTasks(params: ListTasksRequest, options?: RequestOptions): Promise<ListTasksResponse> {
    const rpcResponse = await this._sendGrpcRequest<ListTasksRequest, ListTasksResponse>(
      'listTasks',
      params,
      options,
      this.grpcClient.listTasks.bind(this.grpcClient)
    );
    return rpcResponse;
  }

  async *resubscribeTask(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    yield* this._sendGrpcStreamingRequest(
      'subscribeToTask',
      params,
      options,
      this.grpcClient.subscribeToTask.bind(this.grpcClient)
    );
  }

  private async _sendGrpcRequestWithConverter<TReq, TRes, TResponse>(
    method: keyof A2AServiceClient,
    params: TReq,
    options: RequestOptions | undefined,
    call: GrpcUnaryCall<TReq, TRes>,
    converter: (res: TRes) => TResponse
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      let onAbort: (() => void) | undefined;

      const clientCall = call(
        params,
        this._buildMetadata(options),
        this.grpcCallOptions ?? {},
        (error, response) => {
          if (options?.signal && onAbort) {
            options.signal.removeEventListener('abort', onAbort);
          }
          if (error) {
            return reject(GrpcTransport.mapToError(error, method));
          }
          resolve(converter(response));
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

  private async _sendGrpcRequest<TReq, TRes>(
    method: keyof A2AServiceClient,
    params: TReq,
    options: RequestOptions | undefined,
    call: GrpcUnaryCall<TReq, TRes>
  ): Promise<TRes> {
    return this._sendGrpcRequestWithConverter(method, params, options, call, (res: TRes) => res);
  }

  private async *_sendGrpcStreamingRequest<TReq>(
    method: 'sendStreamingMessage' | 'subscribeToTask',
    params: TReq,
    options: RequestOptions | undefined,
    call: GrpcStreamCall<TReq, StreamResponse>
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const streamResponse = call(params, this._buildMetadata(options), this.grpcCallOptions ?? {});

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
      for await (const response of streamResponse) {
        yield response;
      }
    } catch (error) {
      if (this.isServiceError(error)) {
        throw GrpcTransport.mapToError(error, method);
      } else {
        throw new Error(`GRPC error for ${String(method)}!`, {
          cause: error,
        });
      }
    } finally {
      if (options?.signal && onAbort) {
        options.signal.removeEventListener('abort', onAbort);
      }
      streamResponse.cancel();
    }
  }

  private isServiceError(error: unknown): error is grpc.ServiceError {
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

  private static mapFromErrorInfo(error: grpc.ServiceError): Error | undefined {
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

  /**
   * Maps a gRPC ServiceError to an SDK error class.
   *
   * Uses the enriched error model (§10.6): parses `google.rpc.ErrorInfo`
   * from `grpc-status-details-bin` metadata to precisely identify the A2A
   * error type via its `reason` code. For servers that do not include
   * ErrorInfo (e.g., non-A2A gRPC services), returns a generic Error
   * preserving the original gRPC code and details.
   */
  private static mapToError(error: grpc.ServiceError, method?: keyof A2AServiceClient): Error {
    const fromErrorInfo = GrpcTransport.mapFromErrorInfo(error);
    if (fromErrorInfo) return fromErrorInfo;

    const methodContext = method ? ' for ' + String(method) : '';
    return new Error('gRPC error' + methodContext + ': ' + error.code + ' ' + error.details, {
      cause: error,
    });
  }
}

export class GrpcTransportFactoryOptions {
  grpcChannelCredentials?: grpc.ChannelCredentials;
  grpcCallOptions?: Partial<grpc.CallOptions>;
}

export class GrpcTransportFactory implements TransportFactory {
  constructor(private readonly options?: GrpcTransportFactoryOptions) {}

  get protocolName(): string {
    return PROTOCOL_NAME;
  }

  async create(url: string, _agentCard: AgentCard): Promise<Transport> {
    return new GrpcTransport({
      endpoint: url,
      grpcChannelCredentials: this.options?.grpcChannelCredentials,
      grpcCallOptions: this.options?.grpcCallOptions,
    });
  }
}

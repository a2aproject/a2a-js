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
} from '../../../index.js';
import { RequestOptions } from '../../multitransport-client.js';
import { Transport, TransportFactory } from '../transport.js';
import { FromProto } from '../../../types/converters/from_proto.js';

import {
  ExtendedAgentCardNotConfiguredError,
  PushNotificationNotSupportedError,
  TaskNotFoundError,
  TaskNotCancelableError,
  UnsupportedOperationError,
  RequestMalformedError,
} from '../../../errors.js';

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

  async getExtendedAgentCard(options?: RequestOptions): Promise<AgentCard> {
    const rpcResponse = await this._sendGrpcRequest<
      GetExtendedAgentCardRequest,
      AgentCard,
      AgentCard
    >(
      'getExtendedAgentCard',
      { tenant: '' },
      options,
      this.grpcClient.getExtendedAgentCard.bind(this.grpcClient)
    );
    return rpcResponse;
  }

  async sendMessage(
    params: SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const rpcResponse = await this._sendGrpcRequest(
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
      TaskPushNotificationConfig,
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
      ListTaskPushNotificationConfigsResponse,
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
    await this._sendGrpcRequest(
      'deleteTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.deleteTaskPushNotificationConfig.bind(this.grpcClient),
      () => {}
    );
  }

  async getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendGrpcRequest<GetTaskRequest, Task, Task>(
      'getTask',
      params,
      options,
      this.grpcClient.getTask.bind(this.grpcClient)
    );
    return rpcResponse;
  }

  async cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendGrpcRequest<CancelTaskRequest, Task, Task>(
      'cancelTask',
      params,
      options,
      this.grpcClient.cancelTask.bind(this.grpcClient)
    );
    return rpcResponse;
  }

  async listTasks(params: ListTasksRequest, options?: RequestOptions): Promise<ListTasksResponse> {
    const rpcResponse = await this._sendGrpcRequest<
      ListTasksRequest,
      ListTasksResponse,
      ListTasksResponse
    >('listTasks', params, options, this.grpcClient.listTasks.bind(this.grpcClient));
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

  private async _sendGrpcRequest<TReq, TRes, TResponse>(
    method: keyof A2AServiceClient,
    params: TReq,
    options: RequestOptions | undefined,
    call: GrpcUnaryCall<TReq, TRes>,
    converter: (res: TRes) => TResponse = (res) => res as unknown as TResponse
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

  // TODO: the logic of mapToError will be removed in v1.0.0 with the enriched error model (https://a2a-protocol.org/latest/specification/#106-error-handling)
  private static mapToError(error: grpc.ServiceError, method: keyof A2AServiceClient): Error {
    switch (error.code) {
      case grpc.status.NOT_FOUND:
        return new TaskNotFoundError(error.details);
      case grpc.status.FAILED_PRECONDITION:
        if (method === 'cancelTask') {
          return new TaskNotCancelableError(error.details);
        }
        if (method === 'getExtendedAgentCard') {
          return new ExtendedAgentCardNotConfiguredError(error.details);
        }
        break;
      case grpc.status.UNIMPLEMENTED:
        if (
          [
            'getTaskPushNotificationConfig',
            'createTaskPushNotificationConfig',
            'deleteTaskPushNotificationConfig',
            'listTaskPushNotificationConfigs',
          ].includes(method)
        ) {
          return new PushNotificationNotSupportedError(error.details);
        }
        if (['getExtendedAgentCard', 'subscribeToTask'].includes(method)) {
          return new UnsupportedOperationError(error.details);
        }
        break;
      case grpc.status.INVALID_ARGUMENT:
      case grpc.status.INTERNAL:
        return new RequestMalformedError(error.details);
      default:
        break;
    }
    return new Error(`GRPC error for ${String(method)}! ${error.code} ${error.details}`, {
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

import * as grpc from '@grpc/grpc-js';
import { TransportProtocolName } from '../../core.js';
import { A2AServiceClient } from '../../grpc/pb/a2a_services.js';
import {
  MessageSendParams,
  TaskPushNotificationConfig,
  TaskIdParams,
  ListTaskPushNotificationConfigParams,
  DeleteTaskPushNotificationConfigParams,
  TaskQueryParams,
  Task,
  AgentCard,
  GetTaskPushNotificationConfigParams,
} from '../../types.js';
import { A2AStreamEventData, SendMessageResult } from '../client.js';
import { RequestOptions } from '../multitransport-client.js';
import { Transport, TransportFactory } from './transport.js';
import { ToProto } from '../../types/converters/to_proto.js';
import { FromProto } from '../../types/converters/from_proto.js';

import {
  AuthenticatedExtendedCardNotConfiguredError,
  PushNotificationNotSupportedError,
  TaskNotFoundError,
  TaskNotCancelableError,
  UnsupportedOperationError,
} from '../../errors.js';

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

  async getExtendedAgentCard(options?: RequestOptions): Promise<AgentCard> {
    const rpcResponse = await this._sendGrpcRequest(
      'getAgentCard',
      undefined,
      options,
      this.grpcClient.getAgentCard.bind(this.grpcClient),
      () => ({}),
      FromProto.agentCard
    );
    return rpcResponse;
  }

  async sendMessage(
    params: MessageSendParams,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const rpcResponse = await this._sendGrpcRequest(
      'sendMessage',
      params,
      options,
      this.grpcClient.sendMessage.bind(this.grpcClient),
      ToProto.messageSendParams,
      FromProto.sendMessageResult
    );
    return rpcResponse;
  }

  async *sendMessageStream(
    params: MessageSendParams,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendGrpcStreamingRequest(
      'sendStreamingMessage',
      params,
      options,
      this.grpcClient.sendStreamingMessage.bind(this.grpcClient),
      ToProto.messageSendParams
    );
  }

  async setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendGrpcRequest(
      'createTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.createTaskPushNotificationConfig.bind(this.grpcClient),
      ToProto.taskPushNotificationConfigCreate,
      FromProto.taskPushNotificationConfig
    );
    return rpcResponse;
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendGrpcRequest(
      'getTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.getTaskPushNotificationConfig.bind(this.grpcClient),
      ToProto.getTaskPushNotificationConfigParams,
      FromProto.taskPushNotificationConfig
    );
    return rpcResponse;
  }

  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig[]> {
    const rpcResponse = await this._sendGrpcRequest(
      'listTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.listTaskPushNotificationConfig.bind(this.grpcClient),
      ToProto.listTaskPushNotificationConfigParams,
      FromProto.listTaskPushNotificationConfig
    );
    return rpcResponse;
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<void> {
    await this._sendGrpcRequest(
      'deleteTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.deleteTaskPushNotificationConfig.bind(this.grpcClient),
      ToProto.deleteTaskPushNotificationConfigParams,
      () => {}
    );
  }

  async getTask(params: TaskQueryParams, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendGrpcRequest(
      'getTask',
      params,
      options,
      this.grpcClient.getTask.bind(this.grpcClient),
      ToProto.taskQueryParams,
      FromProto.task
    );
    return rpcResponse;
  }

  async cancelTask(params: TaskIdParams, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendGrpcRequest(
      'cancelTask',
      params,
      options,
      this.grpcClient.cancelTask.bind(this.grpcClient),
      ToProto.cancelTaskRequest,
      FromProto.task
    );
    return rpcResponse;
  }

  async *resubscribeTask(
    params: TaskIdParams,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendGrpcStreamingRequest(
      'taskSubscription',
      params,
      options,
      this.grpcClient.taskSubscription.bind(this.grpcClient),
      ToProto.taskIdParams
    );
  }

  private async _sendGrpcRequest<TReq, TRes, TParams, TResponse>(
    method: keyof A2AServiceClient,
    params: TParams,
    options: RequestOptions | undefined,
    call: GrpcUnaryCall<TReq, TRes>,
    parser: (req: TParams) => TReq,
    converter: (res: TRes) => TResponse
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      call(
        parser(params),
        this._buildMetadata(options),
        this.grpcCallOptions ?? {},
        (error, response) => {
          if (error) {
            return reject(GrpcTransport.mapToError(error, method));
          }
          resolve(converter(response));
        }
      );
    });
  }

  private async *_sendGrpcStreamingRequest<TReq, TRes, TParams>(
    method: 'sendStreamingMessage' | 'taskSubscription',
    params: TParams,
    options: RequestOptions | undefined,
    call: GrpcStreamCall<TReq, TRes>,
    parser: (req: TParams) => TReq
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    const streamResponse = call(
      parser(params),
      this._buildMetadata(options),
      this.grpcCallOptions ?? {}
    );
    try {
      for await (const response of streamResponse) {
        const payload = response.payload;
        switch (payload.$case) {
          case 'msg':
            yield FromProto.message(payload.value);
            break;
          case 'task':
            yield FromProto.task(payload.value);
            break;
          case 'statusUpdate':
            yield FromProto.taskStatusUpdateEvent(payload.value);
            break;
          case 'artifactUpdate':
            yield FromProto.taskArtifactUpdateEvent(payload.value);
            break;
        }
      }
    } catch (error) {
      if (this.isServiceError(error)) {
        throw GrpcTransport.mapToError(error, method);
      } else {
        throw error;
      }
    } finally {
      streamResponse.cancel();
    }
  }

  private isServiceError(error: unknown): error is grpc.ServiceError {
    return typeof error === 'object' && error !== null && 'code' in error;
  }

  private _buildMetadata(options?: RequestOptions): grpc.Metadata {
    const metadata = new grpc.Metadata();
    if (options?.serviceParameters) {
      for (const [key, value] of Object.entries(options.serviceParameters)) {
        metadata.set(key, value);
      }
    }
    return metadata;
  }

  private static mapToError(error: grpc.ServiceError, method: keyof A2AServiceClient): Error {
    switch (error.code) {
      case grpc.status.NOT_FOUND:
        return new TaskNotFoundError(error.details);
      case grpc.status.FAILED_PRECONDITION:
        if (method === 'cancelTask') {
          return new TaskNotCancelableError(error.details);
        }
        if (method === 'getAgentCard') {
          return new AuthenticatedExtendedCardNotConfiguredError(error.details);
        }
        break;
      case grpc.status.UNIMPLEMENTED:
        if (
          [
            'getTaskPushNotificationConfig',
            'createTaskPushNotificationConfig',
            'deleteTaskPushNotificationConfig',
            'listTaskPushNotificationConfig',
          ].includes(method)
        ) {
          return new PushNotificationNotSupportedError(error.details);
        }
        if (['getAgentCard', 'taskSubscription'].includes(method)) {
          return new UnsupportedOperationError(error.details);
        }
        break;
      //TODO: add case for grpc.status.INVALID_ARGUMENT and grpc.status.INTERNAL
      default:
        break;
    }
    return new Error(`GRPC error for ${String(method)}! ${error.code} ${error.details}`, {
      cause: error,
    });
  }
}

export class GrpcTransportFactoryOptions {
  grpcClient?: A2AServiceClient;
  grpcChannelCredentials?: grpc.ChannelCredentials;
  grpcCallOptions?: Partial<grpc.CallOptions>;
}

export class GrpcTransportFactory implements TransportFactory {
  public static readonly name: TransportProtocolName = 'GRPC';

  constructor(private readonly options?: GrpcTransportFactoryOptions) {}

  get protocolName(): string {
    return GrpcTransportFactory.name;
  }

  async create(url: string, _agentCard: AgentCard): Promise<Transport> {
    return new GrpcTransport({
      endpoint: url,
      grpcChannelCredentials: this.options?.grpcChannelCredentials,
      grpcCallOptions: this.options?.grpcCallOptions,
    });
  }
}

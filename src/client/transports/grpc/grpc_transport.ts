import * as grpc from '@grpc/grpc-js';
import { TransportProtocolName } from '../../../core.js';
import { A2AServiceClient, TaskPushNotificationConfig } from '../../../grpc/pb/a2a_services.js';
import { Task, AgentCard } from '../../../types/pb/a2a_types.js';
import {
  CancelTaskRequest,
  CreateTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetAgentCardRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigRequest,
  SendMessageRequest,
  TaskSubscriptionRequest,
} from '../../../types/pb/a2a_types.js';
import { A2AStreamEventData, SendMessageResult } from '../../client.js';
import { RequestOptions } from '../../multitransport-client.js';
import { Transport, TransportFactory } from '../transport.js';
import { FromProto } from '../../../types/converters/from_proto.js';

import {
  AuthenticatedExtendedCardNotConfiguredError,
  PushNotificationNotSupportedError,
  TaskNotFoundError,
  TaskNotCancelableError,
  UnsupportedOperationError,
} from '../../../errors.js';

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
      {} as GetAgentCardRequest,
      options,
      this.grpcClient.getAgentCard.bind(this.grpcClient),
      FromProto.agentCard
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
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendGrpcStreamingRequest(
      'sendStreamingMessage',
      params,
      options,
      this.grpcClient.sendStreamingMessage.bind(this.grpcClient)
    );
  }

  async setTaskPushNotificationConfig(
    params: CreateTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendGrpcRequest(
      'createTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.createTaskPushNotificationConfig.bind(this.grpcClient),
      FromProto.taskPushNotificationConfig
    );
    return rpcResponse;
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendGrpcRequest(
      'getTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.getTaskPushNotificationConfig.bind(this.grpcClient),
      FromProto.taskPushNotificationConfig
    );
    return rpcResponse;
  }

  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig[]> {
    const rpcResponse = await this._sendGrpcRequest(
      'listTaskPushNotificationConfig',
      params,
      options,
      this.grpcClient.listTaskPushNotificationConfig.bind(this.grpcClient),
      FromProto.listTaskPushNotificationConfig
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
    const rpcResponse = await this._sendGrpcRequest(
      'getTask',
      params,
      options,
      this.grpcClient.getTask.bind(this.grpcClient),
      FromProto.task
    );
    return rpcResponse;
  }

  async cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendGrpcRequest(
      'cancelTask',
      params,
      options,
      this.grpcClient.cancelTask.bind(this.grpcClient),
      FromProto.task
    );
    return rpcResponse;
  }

  async *resubscribeTask(
    params: TaskSubscriptionRequest,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendGrpcStreamingRequest(
      'taskSubscription',
      params,
      options,
      this.grpcClient.taskSubscription.bind(this.grpcClient)
    );
  }

  private async _sendGrpcRequest<TReq, TRes, TResponse>(
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

  private async *_sendGrpcStreamingRequest<TReq, TRes>(
    method: 'sendStreamingMessage' | 'taskSubscription',
    params: TReq,
    options: RequestOptions | undefined,
    call: GrpcStreamCall<TReq, TRes>
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
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
        yield FromProto.messageStreamResult(response);
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
      //TODO: add case for grpc.status.INVALID_ARGUMENT and grpc.status.INTERNAL (the respective a2a errors are not implemented yet)
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

import {
  CallOptions,
  credentials,
  ServiceError,
  Metadata,
  ClientUnaryCall,
  ClientReadableStream,
  ChannelCredentials,
} from '@grpc/grpc-js';
import { TransportProtocolName } from '../../core.js';
import { A2AServiceClient } from '../../grpc/a2a.js';
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
import { ToProto } from '../../grpc/utils/to_proto.js';
import { FromProto } from '../../grpc/utils/from_proto.js';
import {
  A2A_ERROR_CODE,
  AuthenticatedExtendedCardNotConfiguredError,
  ContentTypeNotSupportedError,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  TaskNotFoundError,
  TaskNotCancelableError,
  UnsupportedOperationError,
} from '../../errors.js';

type GrpcUnaryCall<TReq, TRes> = (
  request: TReq,
  metadata: Metadata,
  options: Partial<CallOptions>,
  callback: (error: ServiceError | null, response: TRes) => void
) => ClientUnaryCall;

type GrpcStreamCall<TReq, TRes> = (
  request: TReq,
  metadata?: Metadata,
  options?: Partial<CallOptions>
) => ClientReadableStream<TRes>;

export interface GrpcTransportOptions {
  endpoint: string;
  grpcClient?: A2AServiceClient;
  grpcChannelCredentials?: ChannelCredentials;
  grpcCallOptions?: Partial<CallOptions>;
}

export class GrpcTransport implements Transport {
  private readonly grpcCallOptions?: Partial<CallOptions>;
  private readonly grpcClient: A2AServiceClient;

  constructor(options: GrpcTransportOptions) {
    this.grpcCallOptions = options.grpcCallOptions;
    this.grpcClient =
      options.grpcClient ??
      new A2AServiceClient(
        options.endpoint,
        options.grpcChannelCredentials ?? credentials.createInsecure()
      );
  }

  async getExtendedAgentCard(options?: RequestOptions): Promise<AgentCard> {
    const rpcResponse = await this._sendGrpcRequest(
      'getAgentCard',
      undefined,
      options,
      this.grpcClient.getAgentCard.bind(this.grpcClient),
      () => {},
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
      FromProto.getTaskPushNoticationConfig
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
      ToProto.getTaskPushNotificationConfigRequest,
      FromProto.getTaskPushNoticationConfig
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
      ToProto.listTaskPushNotificationConfigRequest,
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
      ToProto.deleteTaskPushNotificationConfigRequest,
      () => {}
    );
  }

  async getTask(params: TaskQueryParams, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendGrpcRequest(
      'getTask',
      params,
      options,
      this.grpcClient.getTask.bind(this.grpcClient),
      ToProto.getTaskRequest,
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
            if (this.isA2AServiceError(error)) {
              return reject(GrpcTransport.mapToError(error));
            }
            const statusInfo = 'code' in error ? `(Status: ${error.code})` : '';
            return reject(
              new Error(`GRPC error for ${String(method)}! ${statusInfo} ${error.message}`, {
                cause: error,
              })
            );
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
            yield FromProto.taskStatusUpdate(payload.value);
            break;
          case 'artifactUpdate':
            yield FromProto.taskArtifactUpdate(payload.value);
            break;
        }
      }
    } catch (error) {
      if (this.isServiceError(error)) {
        if (this.isA2AServiceError(error)) {
          throw GrpcTransport.mapToError(error);
        }
        throw new Error(`GRPC error for ${String(method)}! ${error.code} ${error.message}`, {
          cause: error,
        });
      } else {
        throw error;
      }
    } finally {
      streamResponse.cancel();
    }
  }

  private isA2AServiceError(error: ServiceError): boolean {
    return (
      typeof error === 'object' && error !== null && error.metadata?.get('a2a-error').length === 1
    );
  }

  private isServiceError(error: unknown): error is ServiceError {
    return typeof error === 'object' && error !== null && 'code' in error;
  }

  private _buildMetadata(options?: RequestOptions): Metadata {
    const metadata = new Metadata();
    if (options?.serviceParameters) {
      for (const [key, value] of Object.entries(options.serviceParameters)) {
        metadata.set(key, value);
      }
    }
    return metadata;
  }

  private static mapToError(error: ServiceError): Error {
    const a2aErrorCode = error.metadata.get('a2a-error');
    switch (Number(a2aErrorCode[0])) {
      case A2A_ERROR_CODE.TASK_NOT_FOUND:
        return new TaskNotFoundError(error.message);
      case A2A_ERROR_CODE.TASK_NOT_CANCELABLE:
        return new TaskNotCancelableError(error.message);
      case A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED:
        return new PushNotificationNotSupportedError(error.message);
      case A2A_ERROR_CODE.UNSUPPORTED_OPERATION:
        return new UnsupportedOperationError(error.message);
      case A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED:
        return new ContentTypeNotSupportedError(error.message);
      case A2A_ERROR_CODE.INVALID_AGENT_RESPONSE:
        return new InvalidAgentResponseError(error.message);
      case A2A_ERROR_CODE.AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED:
        return new AuthenticatedExtendedCardNotConfiguredError(error.message);
      default:
        return new Error(
          `GRPC error: ${error.message} Code: ${error.code} Details: ${error.details}`
        );
    }
  }
}

export class GrpcTransportFactoryOptions {
  grpcClient?: A2AServiceClient;
  grpcChannelCredentials?: ChannelCredentials;
  grpcCallOptions?: Partial<CallOptions>;
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
      grpcClient: this.options?.grpcClient,
      grpcChannelCredentials: this.options?.grpcChannelCredentials,
      grpcCallOptions: this.options?.grpcCallOptions,
    });
  }
}

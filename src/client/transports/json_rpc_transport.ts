import { TransportProtocolName } from '../../core.js';
import {
  A2A_ERROR_CODE,
  AuthenticatedExtendedCardNotConfiguredError,
  ContentTypeNotSupportedError,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  RequestMalformedError,
} from '../../errors.js';
import {
  Task,
  AgentCard,
  TaskPushNotificationConfig,
  A2AStreamEventData,
  SendMessageResult,
} from '../../index.js';
import { RequestOptions } from '../multitransport-client.js';
import { parseSseStream } from '../../sse_utils.js';
import { Transport, TransportFactory } from './transport.js';
import {
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  MessageFns,
  SendMessageRequest,
  SubscribeToTaskRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  SendMessageResponse,
  ListTaskPushNotificationConfigsResponse,
  StreamResponse,
} from '../../types/pb/a2a.js';

export interface JsonRpcTransportOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

export class JsonRpcTransport implements Transport {
  private readonly customFetchImpl?: typeof fetch;
  private readonly endpoint: string;
  private requestIdCounter: number = 1;

  constructor(options: JsonRpcTransportOptions) {
    this.endpoint = options.endpoint;
    this.customFetchImpl = options.fetchImpl;
  }

  async getExtendedAgentCard(options?: RequestOptions): Promise<AgentCard> {
    const rpcResponse = await this._sendRpcRequest<undefined, AgentCard>(
      'agent/getAuthenticatedExtendedCard',
      undefined,
      options,
      undefined
    );
    return rpcResponse.result;
  }

  async sendMessage(
    params: SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const rpcResponse = await this._sendRpcRequest<SendMessageRequest, SendMessageResponse>(
      'message/send',
      params,
      options,
      SendMessageRequest
    );

    if (!rpcResponse.result?.payload?.value) {
      throw new Error('Invalid response structure from agent.');
    }

    return rpcResponse.result.payload.value;
  }

  async *sendMessageStream(
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendStreamingRequest<SendMessageRequest>(
      'message/stream',
      params,
      options,
      SendMessageRequest
    );
  }

  async createTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendRpcRequest<
      TaskPushNotificationConfig,
      TaskPushNotificationConfig
    >('tasks/pushNotificationConfig/create', params, options, TaskPushNotificationConfig);
    return TaskPushNotificationConfig.fromJSON(rpcResponse.result);
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendRpcRequest<
      GetTaskPushNotificationConfigRequest,
      TaskPushNotificationConfig
    >('tasks/pushNotificationConfig/get', params, options, GetTaskPushNotificationConfigRequest);
    return TaskPushNotificationConfig.fromJSON(rpcResponse.result);
  }

  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig[]> {
    const rpcResponse = await this._sendRpcRequest<
      ListTaskPushNotificationConfigsRequest,
      ListTaskPushNotificationConfigsResponse
    >('tasks/pushNotificationConfig/list', params, options, ListTaskPushNotificationConfigsRequest);
    const configs = rpcResponse.result.configs || [];
    return configs.map((c: unknown) => TaskPushNotificationConfig.fromJSON(c));
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void> {
    await this._sendRpcRequest<DeleteTaskPushNotificationConfigRequest, void>(
      'tasks/pushNotificationConfig/delete',
      params,
      options,
      DeleteTaskPushNotificationConfigRequest
    );
  }

  async getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendRpcRequest<GetTaskRequest, Task>(
      'tasks/get',
      params,
      options,
      GetTaskRequest
    );
    return Task.fromJSON(rpcResponse.result);
  }

  async cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendRpcRequest<CancelTaskRequest, Task>(
      'tasks/cancel',
      params,
      options,
      CancelTaskRequest
    );
    return Task.fromJSON(rpcResponse.result);
  }

  async *resubscribeTask(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendStreamingRequest<SubscribeToTaskRequest>(
      'tasks/resubscribe',
      params,
      options,
      SubscribeToTaskRequest
    );
  }

  async callExtensionMethod<TExtensionParams, TExtensionResponse>(
    method: string,
    params: TExtensionParams,
    options?: RequestOptions
  ) {
    return await this._sendRpcRequest<TExtensionParams, TExtensionResponse>(
      method,
      params,
      options,
      undefined
    );
  }

  private _fetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    if (this.customFetchImpl) {
      return this.customFetchImpl(...args);
    }
    if (typeof fetch === 'function') {
      return fetch(...args);
    }
    throw new Error(
      'A `fetch` implementation was not provided and is not available in the global scope. ' +
        'Please provide a `fetchImpl` in the A2ATransportOptions. '
    );
  }

  private async _sendRpcRequest<TParams, TResponsePayload>(
    method: string,
    params: TParams,
    options: RequestOptions | undefined,
    requestType: MessageFns<TParams> | undefined
  ): Promise<JSONRPCSuccessResponse<TResponsePayload>> {
    const requestId = this.requestIdCounter++;

    const rpcRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      method,
      params: requestType?.toJSON(params) ?? params,
      id: requestId,
    };

    const httpResponse = await this._fetchRpc(rpcRequest, 'application/json', options);

    if (!httpResponse.ok) {
      let errorBodyText = '(empty or non-JSON response)';
      let errorJson: JSONRPCErrorResponse;
      try {
        errorBodyText = await httpResponse.text();
        errorJson = JSON.parse(errorBodyText);
      } catch (e) {
        throw new Error(
          `HTTP error for ${method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`,
          { cause: e }
        );
      }
      if (errorJson.jsonrpc && errorJson.error) {
        throw JsonRpcTransport.mapToError(errorJson);
      } else {
        throw new Error(
          `HTTP error for ${method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`
        );
      }
    }

    const json = await httpResponse.json();
    if ('error' in json) {
      throw JsonRpcTransport.mapToError(json as JSONRPCErrorResponse);
    }

    const rpcResponse = json as JSONRPCSuccessResponse<TResponsePayload>;
    if (rpcResponse.id !== requestId) {
      throw new Error(
        `JSON-RPC response ID mismatch for method ${method}. Expected ${requestId}, got ${rpcResponse.id}.`
      );
    }

    return rpcResponse;
  }

  private async _fetchRpc(
    rpcRequest: JSONRPCRequest,
    acceptHeader: string = 'application/json',
    options?: RequestOptions
  ): Promise<Response> {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        ...options?.serviceParameters,
        'Content-Type': 'application/json',
        Accept: acceptHeader,
      },
      body: JSON.stringify(rpcRequest),
      signal: options?.signal,
    };
    return this._fetch(this.endpoint, requestInit);
  }

  private async *_sendStreamingRequest<TParams>(
    method: string,
    params: TParams,
    options: RequestOptions | undefined,
    requestType: MessageFns<TParams> | undefined
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    const clientRequestId = this.requestIdCounter++;
    const rpcRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      method,
      params: requestType?.toJSON(params) ?? params,
      id: clientRequestId,
    };

    const response = await this._fetchRpc(rpcRequest, 'text/event-stream', options);

    if (!response.ok) {
      let errorBody = '';
      let errorJson: JSONRPCErrorResponse;
      try {
        errorBody = await response.text();
        errorJson = JSON.parse(errorBody);
      } catch (e) {
        throw new Error(
          `HTTP error establishing stream for ${method}: ${response.status} ${response.statusText}. Response: ${errorBody || '(empty)'}`,
          { cause: e }
        );
      }
      if (errorJson.error) {
        throw new Error(
          `HTTP error establishing stream for ${method}: ${response.status} ${response.statusText}. RPC Error: ${errorJson.error.message} (Code: ${errorJson.error.code})`
        );
      }
      throw new Error(
        `HTTP error establishing stream for ${method}: ${response.status} ${response.statusText}`
      );
    }
    if (!response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
      throw new Error(
        `Invalid response Content-Type for SSE stream for ${method}. Expected 'text/event-stream'.`
      );
    }

    for await (const event of parseSseStream(response)) {
      yield this._processSseEventData<A2AStreamEventData>(event.data, clientRequestId);
    }
  }

  private _processSseEventData<TStreamItem>(
    jsonData: string,
    originalRequestId: number | string | null
  ): TStreamItem {
    if (!jsonData.trim()) {
      throw new Error('Attempted to process empty SSE event data.');
    }

    let a2aStreamResponse: JSONRPCResponse<StreamResponse>;
    try {
      a2aStreamResponse = JSON.parse(jsonData) as JSONRPCResponse<StreamResponse>;
    } catch (e) {
      throw new Error(
        `Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${(e instanceof Error && e.message) || 'Unknown error'}`,
        { cause: e }
      );
    }

    if (a2aStreamResponse.id !== originalRequestId) {
      throw new Error(
        `JSON-RPC response ID mismatch in SSE event. Expected ${originalRequestId}, got ${a2aStreamResponse.id}.`
      );
    }

    if ('error' in a2aStreamResponse) {
      const err = a2aStreamResponse.error;
      throw new Error(
        `SSE event contained an error: ${err.message} (Code: ${err.code}) Data: ${JSON.stringify(err.data || {})}`,
        { cause: JsonRpcTransport.mapToError(a2aStreamResponse) }
      );
    }

    if (!('result' in a2aStreamResponse) || typeof a2aStreamResponse.result === 'undefined') {
      throw new Error(`SSE event JSON-RPC response is missing 'result' field. Data: ${jsonData}`);
    }

    const result = a2aStreamResponse.result;
    if (result?.payload?.value) {
      return result.payload.value as TStreamItem;
    }

    return result as TStreamItem;
  }

  private static mapToError(response: JSONRPCErrorResponse): Error {
    const errorMessage = response.error.message;
    switch (response.error.code) {
      case A2A_ERROR_CODE.PARSE_ERROR:
      case A2A_ERROR_CODE.INVALID_REQUEST:
      case A2A_ERROR_CODE.METHOD_NOT_FOUND:
      case A2A_ERROR_CODE.INVALID_PARAMS:
      case A2A_ERROR_CODE.INTERNAL_ERROR:
        return new RequestMalformedError(errorMessage);
      case A2A_ERROR_CODE.TASK_NOT_FOUND:
        return new TaskNotFoundError(errorMessage);
      case A2A_ERROR_CODE.TASK_NOT_CANCELABLE:
        return new TaskNotCancelableError(errorMessage);
      case A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED:
        return new PushNotificationNotSupportedError(errorMessage);
      case A2A_ERROR_CODE.UNSUPPORTED_OPERATION:
        return new UnsupportedOperationError(errorMessage);
      case A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED:
        return new ContentTypeNotSupportedError(errorMessage);
      case A2A_ERROR_CODE.INVALID_AGENT_RESPONSE:
        return new InvalidAgentResponseError(errorMessage);
      case A2A_ERROR_CODE.AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED:
        return new AuthenticatedExtendedCardNotConfiguredError(errorMessage);
      default:
        return new JSONRPCTransportError(response);
    }
  }
}

export class JsonRpcTransportFactoryOptions {
  fetchImpl?: typeof fetch;
}

export class JsonRpcTransportFactory implements TransportFactory {
  public static readonly name: TransportProtocolName = 'JSONRPC';

  constructor(private readonly options?: JsonRpcTransportFactoryOptions) {}

  get protocolName(): string {
    return JsonRpcTransportFactory.name;
  }

  async create(url: string, _agentCard: AgentCard): Promise<Transport> {
    return new JsonRpcTransport({
      endpoint: url,
      fetchImpl: this.options?.fetchImpl,
    });
  }
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
  id: string | number | null;
}

export interface JSONRPCSuccessResponse<T> {
  jsonrpc: '2.0';
  result: T;
  id: string | number | null;
}

export interface JSONRPCError {
  code: number;
  data?: { [k: string]: unknown };
  message: string;
}

export interface JSONRPCErrorResponse {
  error: JSONRPCError;
  id: string | number | null;
  jsonrpc: '2.0';
}

export type JSONRPCResponse<T> = JSONRPCSuccessResponse<T> | JSONRPCErrorResponse;

export class JSONRPCTransportError extends Error {
  constructor(public errorResponse: JSONRPCErrorResponse) {
    super(
      `JSON-RPC error: ${errorResponse.error.message} (Code: ${errorResponse.error.code}) Data: ${JSON.stringify(errorResponse.error.data || {})}`
    );
  }
}

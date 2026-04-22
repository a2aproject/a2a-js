import { TransportProtocolName } from '../../core.js';
import {
  A2A_ERROR_CODE,
  ContentTypeNotSupportedError,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  TaskNotFoundError,
  TaskNotCancelableError,
  UnsupportedOperationError,
  RequestMalformedError,
  ExtendedAgentCardNotConfiguredError,
} from '../../errors.js';

import { SendMessageResult } from '../../index.js';
import { RequestOptions } from '../multitransport-client.js';
import { parseSseStream } from '../../sse_utils.js';
import { Transport, TransportFactory } from './transport.js';
import { FromProto } from '../../types/converters/from_proto.js';
import {
  AgentCard,
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetExtendedAgentCardRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  MessageFns,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskPushNotificationConfig,
  SubscribeToTaskRequest,
  ListTasksRequest,
  ListTasksResponse,
  TaskState,
  taskStateToJSON,
} from '../../types/pb/a2a.js';

const PROTOCOL_NAME: TransportProtocolName = 'HTTP+JSON';

export interface RestTransportOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

interface RestErrorResponse {
  name?: string;
  message?: string;
  code?: number;
  data?: Record<string, unknown>;
}

export class RestTransport implements Transport {
  private readonly customFetchImpl?: typeof fetch;
  private readonly endpoint: string;

  constructor(options: RestTransportOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.customFetchImpl = options.fetchImpl;
  }

  private _buildPath(path: string, tenant?: string): string {
    return tenant ? '/' + encodeURIComponent(tenant) + path : path;
  }

  get protocolName(): string {
    return PROTOCOL_NAME;
  }

  async getExtendedAgentCard(
    params: GetExtendedAgentCardRequest,
    options?: RequestOptions
  ): Promise<AgentCard> {
    const path = this._buildPath('/extendedAgentCard', params.tenant);
    const response = await this._sendRequest<undefined, AgentCard>(
      'GET',
      path,
      undefined,
      options,
      undefined,
      AgentCard
    );
    return response;
  }

  async sendMessage(
    params: SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const requestBody = params;
    const path = this._buildPath('/message:send', params.tenant);
    const response = await this._sendRequest<SendMessageRequest, SendMessageResponse>(
      'POST',
      path,
      requestBody,
      options,
      SendMessageRequest,
      SendMessageResponse
    );
    return FromProto.sendMessageResult(response);
  }

  async *sendMessageStream(
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const requestBody = SendMessageRequest.toJSON(params);
    const path = this._buildPath('/message:stream', params.tenant);
    yield* this._sendStreamingRequest(path, requestBody, options);
  }

  async createTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const path = this._buildPath(
      `/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`,
      params.tenant
    );
    const response = await this._sendRequest<
      TaskPushNotificationConfig,
      TaskPushNotificationConfig
    >('POST', path, params, options, TaskPushNotificationConfig, TaskPushNotificationConfig);
    return response;
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const path = this._buildPath(
      `/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/${encodeURIComponent(
        params.id
      )}`,
      params.tenant
    );
    const response = await this._sendRequest<void, TaskPushNotificationConfig>(
      'GET',
      path,
      undefined,
      options,
      undefined,
      TaskPushNotificationConfig
    );
    return response;
  }

  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<ListTaskPushNotificationConfigsResponse> {
    const path = this._buildPath(
      `/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`,
      params.tenant
    );
    const response = await this._sendRequest<void, ListTaskPushNotificationConfigsResponse>(
      'GET',
      path,
      undefined,
      options,
      undefined,
      ListTaskPushNotificationConfigsResponse
    );
    return response;
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void> {
    const path = this._buildPath(
      `/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/${encodeURIComponent(
        params.id
      )}`,
      params.tenant
    );
    await this._sendRequest<void, void>('DELETE', path, undefined, options, undefined, undefined);
  }

  async getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task> {
    const queryParams = new URLSearchParams();
    if (params.historyLength !== undefined) {
      queryParams.set('historyLength', params.historyLength.toString());
    }
    const queryString = queryParams.toString();
    const path = this._buildPath(
      `/tasks/${encodeURIComponent(params.id)}${queryString ? `?${queryString}` : ''}`,
      params.tenant
    );
    const response = await this._sendRequest<void, Task>(
      'GET',
      path,
      undefined,
      options,
      undefined,
      Task
    );
    return response;
  }

  async cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task> {
    const path = this._buildPath(`/tasks/${encodeURIComponent(params.id)}:cancel`, params.tenant);
    const response = await this._sendRequest<void, Task>(
      'POST',
      path,
      undefined,
      options,
      undefined,
      Task
    );
    return response;
  }

  async listTasks(params: ListTasksRequest, options?: RequestOptions): Promise<ListTasksResponse> {
    const queryParams = new URLSearchParams();
    if (params.contextId) queryParams.set('contextId', params.contextId);
    if (params.status !== undefined && params.status !== TaskState.TASK_STATE_UNSPECIFIED) {
      queryParams.set('status', taskStateToJSON(params.status));
    }
    if (params.pageSize !== undefined) queryParams.set('pageSize', String(params.pageSize));
    if (params.pageToken) queryParams.set('pageToken', params.pageToken);
    if (params.historyLength !== undefined)
      queryParams.set('historyLength', String(params.historyLength));
    if (params.statusTimestampAfter)
      queryParams.set('statusTimestampAfter', params.statusTimestampAfter);
    if (params.includeArtifacts !== undefined)
      queryParams.set('includeArtifacts', String(params.includeArtifacts));

    const queryString = queryParams.toString();
    const path = this._buildPath(`/tasks${queryString ? `?${queryString}` : ''}`, params.tenant);

    const response = await this._sendRequest<void, ListTasksResponse>(
      'GET',
      path,
      undefined,
      options,
      undefined,
      ListTasksResponse
    );
    return response;
  }

  async *resubscribeTask(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const path = this._buildPath(
      `/tasks/${encodeURIComponent(params.id)}:subscribe`,
      params.tenant
    );
    yield* this._sendStreamingRequest(path, undefined, options);
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
        'Please provide a `fetchImpl` in the RestTransportOptions.'
    );
  }

  private _buildHeaders(
    options: RequestOptions | undefined,
    acceptHeader: string = 'application/json'
  ): HeadersInit {
    return {
      ...options?.serviceParameters,
      'Content-Type': 'application/json',
      Accept: acceptHeader,
    };
  }

  private async _sendRequest<TRequest, TResponse>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: TRequest,
    options: RequestOptions | undefined,
    requestType: MessageFns<TRequest> | undefined,
    responseType: MessageFns<TResponse> | undefined
  ): Promise<TResponse> {
    const url = `${this.endpoint}${path}`;
    const requestInit: RequestInit = {
      method,
      headers: this._buildHeaders(options),
      signal: options?.signal,
    };

    if (body !== undefined && method !== 'GET') {
      if (!requestType) {
        throw new Error(
          `Bug: Request body provided for ${method} ${path} but no toJson serializer provided.`
        );
      }
      requestInit.body = JSON.stringify(requestType.toJSON(body));
    }

    const response = await this._fetch(url, requestInit);

    if (!response.ok) {
      await this._handleErrorResponse(response, path);
    }

    if (response.status === 204 || !responseType) {
      return undefined as TResponse;
    }

    const result = await response.json();
    return responseType.fromJSON(result);
  }

  private async _handleErrorResponse(response: Response, path: string): Promise<never> {
    let errorBodyText = '(empty or non-JSON response)';
    let errorBody: RestErrorResponse | undefined;

    try {
      errorBodyText = await response.text();
      if (errorBodyText) {
        errorBody = JSON.parse(errorBodyText);
      }
    } catch (e) {
      throw new Error(
        `HTTP error for ${path}! Status: ${response.status} ${response.statusText}. Response: ${errorBodyText}`,
        { cause: e }
      );
    }

    if (errorBody && (typeof errorBody.name === 'string' || typeof errorBody.code === 'number')) {
      throw RestTransport.mapToError(errorBody, response.status);
    }

    throw new Error(
      `HTTP error for ${path}! Status: ${response.status} ${response.statusText}. Response: ${errorBodyText}`
    );
  }

  private async *_sendStreamingRequest(
    path: string,
    body: unknown | undefined,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const url = `${this.endpoint}${path}`;
    const requestInit: RequestInit = {
      method: 'POST',
      headers: this._buildHeaders(options, 'text/event-stream'),
      signal: options?.signal,
    };

    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }

    const response = await this._fetch(url, requestInit);

    if (!response.ok) {
      await this._handleErrorResponse(response, path);
    }

    const contentType = response.headers.get('Content-Type');
    if (!contentType?.startsWith('text/event-stream')) {
      throw new Error(
        `Invalid response Content-Type for SSE stream. Expected 'text/event-stream', got '${contentType}'.`
      );
    }

    for await (const event of parseSseStream(response)) {
      if (event.type === 'error') {
        const errorData = JSON.parse(event.data);
        throw RestTransport.mapToError(errorData);
      }
      yield this._processSseEventData(event.data);
    }
  }

  private _processSseEventData(jsonData: string): StreamResponse {
    if (!jsonData.trim()) {
      throw new Error('Attempted to process empty SSE event data.');
    }

    try {
      const response = JSON.parse(jsonData);
      return StreamResponse.fromJSON(response);
    } catch (e) {
      console.error('Failed to parse SSE event data:', jsonData, e);
      throw new Error(
        `Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${(e instanceof Error && e.message) || 'Unknown error'}`
      );
    }
  }

  private static mapToError(error: RestErrorResponse, status?: number): Error {
    const message = error.message || 'Unknown error';

    if (error.name) {
      switch (error.name) {
        case 'TaskNotFoundError':
          return new TaskNotFoundError(message);
        case 'TaskNotCancelableError':
          return new TaskNotCancelableError(message);
        case 'PushNotificationNotSupportedError':
          return new PushNotificationNotSupportedError(message);
        case 'UnsupportedOperationError':
          return new UnsupportedOperationError(message);
        case 'ContentTypeNotSupportedError':
          return new ContentTypeNotSupportedError(message);
        case 'InvalidAgentResponseError':
          return new InvalidAgentResponseError(message);
        case 'ExtendedAgentCardNotConfiguredError':
          return new ExtendedAgentCardNotConfiguredError(message);
        case 'RequestMalformedError':
          return new RequestMalformedError(message);
      }
    }

    if (error.code !== undefined) {
      switch (error.code) {
        case A2A_ERROR_CODE.TASK_NOT_FOUND:
          return new TaskNotFoundError(message);
        case A2A_ERROR_CODE.TASK_NOT_CANCELABLE:
          return new TaskNotCancelableError(message);
        case A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED:
          return new PushNotificationNotSupportedError(message);
        case A2A_ERROR_CODE.UNSUPPORTED_OPERATION:
          return new UnsupportedOperationError(message);
        case A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED:
          return new ContentTypeNotSupportedError(message);
        case A2A_ERROR_CODE.INVALID_AGENT_RESPONSE:
          return new InvalidAgentResponseError(message);
        case A2A_ERROR_CODE.EXTENDED_CARD_NOT_CONFIGURED:
          return new ExtendedAgentCardNotConfiguredError(message);
      }
    }

    if (status === 400) return new RequestMalformedError(message);
    if (status === 404) return new TaskNotFoundError(message);
    if (status === 409) return new TaskNotCancelableError(message);

    return new Error(
      `REST error: ${error.name || 'Error'} - ${message}${status ? ` (Status: ${status})` : ''}${error.data ? ` Data: ${JSON.stringify(error.data)}` : ''}`
    );
  }
}

export interface RestTransportFactoryOptions {
  fetchImpl?: typeof fetch;
}

export class RestTransportFactory implements TransportFactory {
  constructor(private readonly options?: RestTransportFactoryOptions) {}

  get protocolName(): string {
    return PROTOCOL_NAME;
  }

  async create(url: string, _agentCard: AgentCard): Promise<Transport> {
    return new RestTransport({
      endpoint: url,
      fetchImpl: this.options?.fetchImpl,
    });
  }
}

import { TransportProtocolName } from '../../core.js';
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
import {
  AgentCard,
  DeleteTaskPushNotificationConfigParams,
  GetTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigParams,
  MessageSendParams,
  TaskPushNotificationConfig,
  TaskIdParams,
  TaskQueryParams,
  Task,
} from '../../types.js';
import { A2AStreamEventData, SendMessageResult } from '../client.js';
import { RequestOptions } from '../multitransport-client.js';
import { parseSseStream } from '../../sse_utils.js';
import { Transport, TransportFactory } from './transport.js';

export interface RestTransportOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

interface RestErrorResponse {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export class RestTransport implements Transport {
  private readonly customFetchImpl?: typeof fetch;
  private readonly endpoint: string;

  constructor(options: RestTransportOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.customFetchImpl = options.fetchImpl;
  }

  async getExtendedAgentCard(options?: RequestOptions): Promise<AgentCard> {
    return this._sendRequest<AgentCard>('GET', '/v1/card', undefined, options);
  }

  async sendMessage(
    params: MessageSendParams,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    return this._sendRequest<SendMessageResult>('POST', '/v1/message:send', params, options);
  }

  async *sendMessageStream(
    params: MessageSendParams,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendStreamingRequest('/v1/message:stream', params, options);
  }

  async setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    return this._sendRequest<TaskPushNotificationConfig>(
      'POST',
      `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`,
      {
        pushNotificationConfig: params.pushNotificationConfig,
      },
      options
    );
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const { pushNotificationConfigId } = params;
    if (!pushNotificationConfigId) {
      throw new Error(
        'pushNotificationConfigId is required for getTaskPushNotificationConfig with REST transport.'
      );
    }
    return this._sendRequest<TaskPushNotificationConfig>(
      'GET',
      `/v1/tasks/${encodeURIComponent(params.id)}/pushNotificationConfigs/${encodeURIComponent(pushNotificationConfigId)}`,
      undefined,
      options
    );
  }

  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig[]> {
    return this._sendRequest<TaskPushNotificationConfig[]>(
      'GET',
      `/v1/tasks/${encodeURIComponent(params.id)}/pushNotificationConfigs`,
      undefined,
      options
    );
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<void> {
    await this._sendRequest<void>(
      'DELETE',
      `/v1/tasks/${encodeURIComponent(params.id)}/pushNotificationConfigs/${encodeURIComponent(params.pushNotificationConfigId)}`,
      undefined,
      options
    );
  }

  async getTask(params: TaskQueryParams, options?: RequestOptions): Promise<Task> {
    const queryParams = new URLSearchParams();
    if (params.historyLength !== undefined) {
      queryParams.set('historyLength', String(params.historyLength));
    }
    const queryString = queryParams.toString();
    const path = `/v1/tasks/${encodeURIComponent(params.id)}${queryString ? `?${queryString}` : ''}`;
    return this._sendRequest<Task>('GET', path, undefined, options);
  }

  async cancelTask(params: TaskIdParams, options?: RequestOptions): Promise<Task> {
    return this._sendRequest<Task>(
      'POST',
      `/v1/tasks/${encodeURIComponent(params.id)}:cancel`,
      undefined,
      options
    );
  }

  async *resubscribeTask(
    params: TaskIdParams,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendStreamingRequest(
      `/v1/tasks/${encodeURIComponent(params.id)}:subscribe`,
      undefined,
      options
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

  private async _sendRequest<TResponse>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown | undefined,
    options: RequestOptions | undefined
  ): Promise<TResponse> {
    const url = `${this.endpoint}${path}`;
    const requestInit: RequestInit = {
      method,
      headers: this._buildHeaders(options),
      signal: options?.signal,
    };

    if (body !== undefined && method !== 'GET') {
      requestInit.body = JSON.stringify(body);
    }

    const response = await this._fetch(url, requestInit);

    if (!response.ok) {
      await this._handleErrorResponse(response, path);
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    const result = await response.json();
    return result as TResponse;
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

    if (errorBody && typeof errorBody.code === 'number') {
      throw RestTransport.mapToError(errorBody);
    }

    throw new Error(
      `HTTP error for ${path}! Status: ${response.status} ${response.statusText}. Response: ${errorBodyText}`
    );
  }

  private async *_sendStreamingRequest(
    path: string,
    body: unknown | undefined,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
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

  private _processSseEventData(jsonData: string): A2AStreamEventData {
    if (!jsonData.trim()) {
      throw new Error('Attempted to process empty SSE event data.');
    }

    try {
      const data = JSON.parse(jsonData);
      return data as A2AStreamEventData;
    } catch (e) {
      console.error('Failed to parse SSE event data:', jsonData, e);
      throw new Error(
        `Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${(e instanceof Error && e.message) || 'Unknown error'}`
      );
    }
  }

  private static mapToError(error: RestErrorResponse): Error {
    switch (error.code) {
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
          `REST error: ${error.message} (Code: ${error.code})${error.data ? ` Data: ${JSON.stringify(error.data)}` : ''}`
        );
    }
  }
}

export interface RestTransportFactoryOptions {
  fetchImpl?: typeof fetch;
}

export class RestTransportFactory implements TransportFactory {
  public static readonly name: TransportProtocolName = 'HTTP+JSON';

  constructor(private readonly options?: RestTransportFactoryOptions) {}

  get protocolName(): string {
    return RestTransportFactory.name;
  }

  async create(url: string, _agentCard: AgentCard): Promise<Transport> {
    return new RestTransport({
      endpoint: url,
      fetchImpl: this.options?.fetchImpl,
    });
  }
}

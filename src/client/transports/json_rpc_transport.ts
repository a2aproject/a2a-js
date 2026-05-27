import { JSONRPCErrorResponse, TransportProtocolName } from '../../core.js';
import { mapJsonRpcErrorToSdkError } from '../../errors.js';
import {
  Task,
  AgentCard,
  TaskPushNotificationConfig,
  SendMessageResult,
  A2A_PROTOCOL_VERSION,
} from '../../index.js';
import { RequestOptions } from '../multitransport-client.js';
import { parseSseStream } from '../../sse_utils.js';
import { isLegacyVersion } from '../../version_utils.js';
import { Transport, TransportFactory } from './transport.js';
import {
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetExtendedAgentCardRequest,
  MessageFns,
  SendMessageRequest,
  SubscribeToTaskRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  SendMessageResponse,
  ListTaskPushNotificationConfigsResponse,
  StreamResponse,
  ListTasksRequest,
  ListTasksResponse,
} from '../../types/pb/a2a.js';
import { JSON_CONTENT_TYPE } from '../../constants.js';
import { LegacyJsonRpcTransport } from '../../compat/v0_3/client/index.js';
import { pickMatchingInterface } from './pick_interface.js';

const PROTOCOL_NAME: TransportProtocolName = 'JSONRPC';

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
    const rpcResponse = await this._sendRpcRequest<GetExtendedAgentCardRequest, AgentCard>(
      'GetExtendedAgentCard',
      params,
      options,
      GetExtendedAgentCardRequest
    );
    return AgentCard.fromJSON(rpcResponse.result);
  }

  async sendMessage(
    params: SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const rpcResponse = await this._sendRpcRequest<SendMessageRequest, SendMessageResponse>(
      'SendMessage',
      params,
      options,
      SendMessageRequest
    );
    const response = SendMessageResponse.fromJSON(rpcResponse.result);
    if (!response.payload) {
      throw new Error('Invalid response: missing payload');
    }
    return response.payload.value;
  }

  async *sendMessageStream(
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    yield* this._sendStreamingRequest<SendMessageRequest>(
      'SendStreamingMessage',
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
    >('CreateTaskPushNotificationConfig', params, options, TaskPushNotificationConfig);
    return TaskPushNotificationConfig.fromJSON(rpcResponse.result);
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendRpcRequest<
      GetTaskPushNotificationConfigRequest,
      TaskPushNotificationConfig
    >('GetTaskPushNotificationConfig', params, options, GetTaskPushNotificationConfigRequest);
    return TaskPushNotificationConfig.fromJSON(rpcResponse.result);
  }

  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<ListTaskPushNotificationConfigsResponse> {
    const rpcResponse = await this._sendRpcRequest<
      ListTaskPushNotificationConfigsRequest,
      ListTaskPushNotificationConfigsResponse
    >('ListTaskPushNotificationConfigs', params, options, ListTaskPushNotificationConfigsRequest);
    return ListTaskPushNotificationConfigsResponse.fromJSON(rpcResponse.result);
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void> {
    await this._sendRpcRequest<DeleteTaskPushNotificationConfigRequest, void>(
      'DeleteTaskPushNotificationConfig',
      params,
      options,
      DeleteTaskPushNotificationConfigRequest
    );
  }

  async getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendRpcRequest<GetTaskRequest, Task>(
      'GetTask',
      params,
      options,
      GetTaskRequest
    );
    return Task.fromJSON(rpcResponse.result);
  }

  async cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task> {
    const rpcResponse = await this._sendRpcRequest<CancelTaskRequest, Task>(
      'CancelTask',
      params,
      options,
      CancelTaskRequest
    );
    return Task.fromJSON(rpcResponse.result);
  }

  async listTasks(params: ListTasksRequest, options?: RequestOptions): Promise<ListTasksResponse> {
    const rpcResponse = await this._sendRpcRequest<ListTasksRequest, ListTasksResponse>(
      'ListTasks',
      params,
      options,
      ListTasksRequest
    );
    return ListTasksResponse.fromJSON(rpcResponse.result);
  }

  async *resubscribeTask(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    yield* this._sendStreamingRequest<SubscribeToTaskRequest>(
      'SubscribeToTask',
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

    const httpResponse = await this._fetchRpc(rpcRequest, JSON_CONTENT_TYPE, options);

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
        throw mapJsonRpcErrorToSdkError(errorJson);
      } else {
        throw new Error(
          `HTTP error for ${method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`
        );
      }
    }

    const json = await httpResponse.json();
    if ('error' in json) {
      throw mapJsonRpcErrorToSdkError(json as JSONRPCErrorResponse);
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
    acceptHeader: string = JSON_CONTENT_TYPE,
    options?: RequestOptions
  ): Promise<Response> {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        ...options?.serviceParameters,
        'Content-Type': JSON_CONTENT_TYPE,
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
  ): AsyncGenerator<StreamResponse, void, undefined> {
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
      try {
        errorBody = await response.text();
        const errorJson: JSONRPCErrorResponse = JSON.parse(errorBody);
        if (errorJson.error) {
          throw mapJsonRpcErrorToSdkError(errorJson);
        }
      } catch (e) {
        if (e instanceof Error && e.name !== 'SyntaxError') {
          throw e;
        }
      }
      throw new Error(
        `HTTP error establishing stream for ${method}: ${response.status} ${response.statusText}. Response: ${errorBody || '(empty)'}`
      );
    }
    if (!response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
      try {
        const body = await response.text();
        const errorJson: JSONRPCErrorResponse = JSON.parse(body);
        if (errorJson.error) {
          throw mapJsonRpcErrorToSdkError(errorJson);
        }
      } catch (e) {
        if (e instanceof Error && e.name !== 'SyntaxError') {
          throw e;
        }
      }
      throw new Error(
        `Invalid response Content-Type for SSE stream for ${method}. Expected 'text/event-stream'.`
      );
    }

    for await (const event of parseSseStream(response)) {
      yield this._processSseEventData(event.data, clientRequestId);
    }
  }

  private _processSseEventData(
    jsonData: string,
    originalRequestId: number | string | null
  ): StreamResponse {
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
        { cause: mapJsonRpcErrorToSdkError(a2aStreamResponse) }
      );
    }

    if (!('result' in a2aStreamResponse) || typeof a2aStreamResponse.result === 'undefined') {
      throw new Error(`SSE event JSON-RPC response is missing 'result' field. Data: ${jsonData}`);
    }

    return StreamResponse.fromJSON(a2aStreamResponse.result);
  }
}

export class JsonRpcTransportFactoryOptions {
  fetchImpl?: typeof fetch;
  /**
   * Enables the v0.3 protocol compatibility layer.
   *
   * When enabled, the factory inspects the matched
   * `AgentInterface.protocolVersion` on every `create()` call; if it
   * falls in `[0.3, 1.0)`, the v0.3 `LegacyJsonRpcTransport` is
   * instantiated instead of the v1.0 `JsonRpcTransport`.
   *
   * Default: omitted (treated as disabled). To talk to v0.3 JSON-RPC
   * agents, the agent card MUST declare a v0.3 `JSONRPC` interface in
   * `supportedInterfaces`; see §3.6.2.
   *
   * When disabled, the v0.3 compat module is never loaded and v0.3
   * agents are not contacted via the compat transport.
   */
  legacyCompat?: { enabled: boolean };
}

/**
 * Factory that produces a JSON-RPC `Transport` for the matched agent
 * interface.
 *
 * When the factory is constructed with `legacyCompat: { enabled: true }`,
 * it transparently dispatches between the v1.0 transport
 * (`JsonRpcTransport`) and the v0.3 compat transport
 * (`LegacyJsonRpcTransport`) based on the matched
 * `AgentInterface.protocolVersion`: when the matched interface declares
 * `protocolVersion` in `[0.3, 1.0)`, the v0.3 transport is used;
 * otherwise (1.0 / empty / missing), the v1.0 transport is used.
 *
 * When `legacyCompat` is omitted or `{ enabled: false }`, the factory
 * always produces the v1.0 `JsonRpcTransport` and never loads the compat
 * module. This mirrors the server-side opt-in convention shared with the
 * Express JSON-RPC and REST handlers.
 *
 * The v0.3 transport module is loaded lazily on demand, so callers that
 * only ever talk to v1.0 agents never pull compat code into their runtime
 * graph.
 */
export class JsonRpcTransportFactory implements TransportFactory {
  constructor(private readonly options?: JsonRpcTransportFactoryOptions) {}

  get protocolName(): string {
    return PROTOCOL_NAME;
  }

  async create(url: string, agentCard: AgentCard): Promise<Transport> {
    if (this.options?.legacyCompat?.enabled) {
      const iface = pickMatchingInterface(agentCard, PROTOCOL_NAME, url);
      if (iface && isLegacyVersion(iface.protocolVersion)) {
        return new LegacyJsonRpcTransport({
          endpoint: url,
          fetchImpl: this.options?.fetchImpl,
        });
      }
    }
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

interface JSONRPCSuccessResponse<T> {
  jsonrpc: '2.0';
  result: T;
  id: string | number | null;
}

type JSONRPCResponse<T> = JSONRPCSuccessResponse<T> | JSONRPCErrorResponse;

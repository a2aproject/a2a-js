/**
 * v0.3 JSON-RPC client transport. Implements the v1.0 `Transport`
 * interface but speaks the v0.3 JSON-RPC wire format. The default
 * `JsonRpcTransportFactory` picks this class automatically for
 * interfaces whose `protocolVersion` falls in the legacy range.
 *
 * `listTasks` throws `Method not found` synchronously — v0.3 JSON-RPC
 * never exposed `tasks/list`.
 */

import { JSON_CONTENT_TYPE } from '../../../../constants.js';
import type { JSONRPCErrorResponse, TransportProtocolName } from '../../../../core.js';
import {
  A2A_ERROR_CODE,
  InvalidAgentResponseError,
  JSONRPCTransportError,
  mapJsonRpcErrorToSdkError,
} from '../../../../errors.js';
import type { SendMessageResult } from '../../../../index.js';
import type { RequestOptions } from '../../../../client/multitransport-client.js';
import { Transport } from '../../../../client/transports/transport.js';
import { parseSseStream } from '../../../../sse_utils.js';
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
} from '../../../../types/pb/a2a.js';
import { A2A_LEGACY_PROTOCOL_VERSION } from '../../constants.js';
import { toCoreAgentCard } from '../../translate/agent_card.js';
import { toCoreMessage } from '../../translate/messages.js';
import { toCoreTaskPushNotificationConfig } from '../../translate/push_notifications.js';
import {
  toCompatCancelTaskRequest,
  toCompatDeleteTaskPushNotificationConfigRequest,
  toCompatGetAuthenticatedExtendedCardRequest,
  toCompatGetTaskPushNotificationConfigRequest,
  toCompatGetTaskRequest,
  toCompatListTaskPushNotificationConfigRequest,
  toCompatSendMessageRequest,
  toCompatSendStreamingMessageRequest,
  toCompatSetTaskPushNotificationConfigRequest,
  toCompatTaskResubscriptionRequest,
  toCoreListTaskPushNotificationConfigsResponse,
  toCoreStreamResponse,
} from '../../translate/requests.js';
import { toCoreTask } from '../../translate/tasks.js';
import type * as legacy from '../../types/types.js';

const PROTOCOL_NAME: TransportProtocolName = 'JSONRPC';

export interface LegacyJsonRpcTransportOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

interface LegacyJsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: string | number | null;
}

interface LegacyJsonRpcSuccessResponse<T> {
  jsonrpc: '2.0';
  result: T;
  id: string | number | null;
}

type LegacyJsonRpcResponse<T> = LegacyJsonRpcSuccessResponse<T> | JSONRPCErrorResponse;

export class LegacyJsonRpcTransport implements Transport {
  private readonly customFetchImpl?: typeof fetch;
  private readonly endpoint: string;
  private requestIdCounter: number = 1;

  constructor(options: LegacyJsonRpcTransportOptions) {
    this.endpoint = options.endpoint;
    this.customFetchImpl = options.fetchImpl;
  }

  get protocolName(): string {
    return PROTOCOL_NAME;
  }

  get protocolVersion(): string {
    return A2A_LEGACY_PROTOCOL_VERSION;
  }

  async getExtendedAgentCard(
    _params: V1GetExtendedAgentCardRequest,
    options?: RequestOptions
  ): Promise<V1AgentCard> {
    const requestId = this.requestIdCounter++;
    // v0.3 `agent/getAuthenticatedExtendedCard` carries no params.
    const envelope = toCompatGetAuthenticatedExtendedCardRequest(
      { tenant: '' },
      requestId
    ) as LegacyJsonRpcRequest;
    const response = await this._sendRpcRequest<legacy.AgentCard>(envelope, options);
    return toCoreAgentCard(response.result);
  }

  async sendMessage(
    params: V1SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatSendMessageRequest(params, requestId) as LegacyJsonRpcRequest;
    const response = await this._sendRpcRequest<legacy.Task | legacy.Message>(envelope, options);
    return LegacyJsonRpcTransport._parseSendMessageResult(response.result);
  }

  async *sendMessageStream(
    params: V1SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatSendStreamingMessageRequest(params, requestId) as LegacyJsonRpcRequest;
    yield* this._sendStreamingRequest(envelope, options);
  }

  async createTaskPushNotificationConfig(
    params: V1TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<V1TaskPushNotificationConfig> {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatSetTaskPushNotificationConfigRequest(
      params,
      requestId
    ) as LegacyJsonRpcRequest;
    const response = await this._sendRpcRequest<legacy.TaskPushNotificationConfig>(
      envelope,
      options
    );
    return toCoreTaskPushNotificationConfig(response.result);
  }

  async getTaskPushNotificationConfig(
    params: V1GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<V1TaskPushNotificationConfig> {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatGetTaskPushNotificationConfigRequest(
      params,
      requestId
    ) as LegacyJsonRpcRequest;
    const response = await this._sendRpcRequest<legacy.TaskPushNotificationConfig>(
      envelope,
      options
    );
    return toCoreTaskPushNotificationConfig(response.result);
  }

  async listTaskPushNotificationConfig(
    params: V1ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<V1ListTaskPushNotificationConfigsResponse> {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatListTaskPushNotificationConfigRequest(
      params,
      requestId
    ) as LegacyJsonRpcRequest;
    const response = await this._sendRpcRequest<legacy.TaskPushNotificationConfig[]>(
      envelope,
      options
    );
    // Wrap the bare list back into the success-response shape that
    // `toCoreListTaskPushNotificationConfigsResponse` expects.
    return toCoreListTaskPushNotificationConfigsResponse({
      id: response.id,
      jsonrpc: '2.0',
      result: response.result,
    });
  }

  async deleteTaskPushNotificationConfig(
    params: V1DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void> {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatDeleteTaskPushNotificationConfigRequest(
      params,
      requestId
    ) as LegacyJsonRpcRequest;
    await this._sendRpcRequest<null>(envelope, options);
  }

  async getTask(params: V1GetTaskRequest, options?: RequestOptions): Promise<V1Task> {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatGetTaskRequest(params, requestId) as LegacyJsonRpcRequest;
    const response = await this._sendRpcRequest<legacy.Task>(envelope, options);
    return toCoreTask(response.result);
  }

  async cancelTask(params: V1CancelTaskRequest, options?: RequestOptions): Promise<V1Task> {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatCancelTaskRequest(params, requestId) as LegacyJsonRpcRequest;
    const response = await this._sendRpcRequest<legacy.Task>(envelope, options);
    return toCoreTask(response.result);
  }

  /** `tasks/list` has no JSON-RPC binding in v0.3. Throws synchronously. */
  async listTasks(
    _params: V1ListTasksRequest,
    _options?: RequestOptions
  ): Promise<V1ListTasksResponse> {
    throw new JSONRPCTransportError({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: A2A_ERROR_CODE.METHOD_NOT_FOUND,
        message: 'Method not found: tasks/list',
      },
    });
  }

  async *resubscribeTask(
    params: V1SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatTaskResubscriptionRequest(params, requestId) as LegacyJsonRpcRequest;
    yield* this._sendStreamingRequest(envelope, options);
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
        'Please provide a `fetchImpl` in the LegacyJsonRpcTransportOptions.'
    );
  }

  private async _sendRpcRequest<TResponsePayload>(
    rpcRequest: LegacyJsonRpcRequest,
    options: RequestOptions | undefined
  ): Promise<LegacyJsonRpcSuccessResponse<TResponsePayload>> {
    const httpResponse = await this._fetchRpc(rpcRequest, JSON_CONTENT_TYPE, options);

    if (!httpResponse.ok) {
      let errorBodyText = '(empty or non-JSON response)';
      let errorJson: JSONRPCErrorResponse;
      try {
        errorBodyText = await httpResponse.text();
        errorJson = JSON.parse(errorBodyText);
      } catch (e) {
        throw new Error(
          `HTTP error for ${rpcRequest.method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`,
          { cause: e }
        );
      }
      if (errorJson.jsonrpc && errorJson.error) {
        throw mapJsonRpcErrorToSdkError(errorJson);
      }
      throw new Error(
        `HTTP error for ${rpcRequest.method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`
      );
    }

    const json = (await httpResponse.json()) as LegacyJsonRpcResponse<TResponsePayload>;
    if ('error' in json) {
      throw mapJsonRpcErrorToSdkError(json);
    }

    if (json.id !== rpcRequest.id) {
      throw new Error(
        `JSON-RPC response ID mismatch for method ${rpcRequest.method}. Expected ${rpcRequest.id}, got ${json.id}.`
      );
    }

    return json;
  }

  private async _fetchRpc(
    rpcRequest: LegacyJsonRpcRequest,
    acceptHeader: string,
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

  private async *_sendStreamingRequest(
    rpcRequest: LegacyJsonRpcRequest,
    options: RequestOptions | undefined
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
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
        `HTTP error establishing stream for ${rpcRequest.method}: ${response.status} ${response.statusText}. Response: ${errorBody || '(empty)'}`
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
        `Invalid response Content-Type for SSE stream for ${rpcRequest.method}. Expected 'text/event-stream'.`
      );
    }

    for await (const event of parseSseStream(response)) {
      yield LegacyJsonRpcTransport._processSseEventData(event.data, rpcRequest.id);
    }
  }

  private static _processSseEventData(
    jsonData: string,
    originalRequestId: number | string | null
  ): V1StreamResponse {
    if (!jsonData.trim()) {
      throw new Error('Attempted to process empty SSE event data.');
    }

    type LegacyStreamResult = legacy.SendStreamingMessageSuccessResponse['result'];
    let legacyStreamResponse: LegacyJsonRpcResponse<LegacyStreamResult>;
    try {
      legacyStreamResponse = JSON.parse(jsonData) as LegacyJsonRpcResponse<LegacyStreamResult>;
    } catch (e) {
      throw new Error(
        `Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${(e instanceof Error && e.message) || 'Unknown error'}`,
        { cause: e }
      );
    }

    if (legacyStreamResponse.id !== originalRequestId) {
      throw new Error(
        `JSON-RPC response ID mismatch in SSE event. Expected ${originalRequestId}, got ${legacyStreamResponse.id}.`
      );
    }

    if ('error' in legacyStreamResponse) {
      const err = legacyStreamResponse.error;
      throw new Error(
        `SSE event contained an error: ${err.message} (Code: ${err.code}) Data: ${JSON.stringify(err.data || {})}`,
        { cause: mapJsonRpcErrorToSdkError(legacyStreamResponse) }
      );
    }

    if (!('result' in legacyStreamResponse) || legacyStreamResponse.result === null) {
      throw new Error(`SSE event JSON-RPC response is missing 'result' field. Data: ${jsonData}`);
    }

    // Wrap in a success-response envelope so `toCoreStreamResponse` can
    // translate to v1.0 `StreamResponse`.
    return toCoreStreamResponse({
      id: legacyStreamResponse.id,
      jsonrpc: '2.0',
      result: legacyStreamResponse.result,
    });
  }

  /** Picks the right translator based on the `kind` discriminator. */
  private static _parseSendMessageResult(result: legacy.Task | legacy.Message): SendMessageResult {
    if (!result) {
      throw new InvalidAgentResponseError('Invalid response: v0.3 message/send result is missing.');
    }
    if (result.kind === 'task') {
      return toCoreTask(result);
    }
    if (result.kind === 'message') {
      return toCoreMessage(result);
    }
    throw new InvalidAgentResponseError(
      `Unexpected v0.3 message/send result kind: ${String((result as { kind?: string }).kind)}`
    );
  }
}

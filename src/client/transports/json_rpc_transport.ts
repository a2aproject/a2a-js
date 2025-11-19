import {
  AuthenticatedExtendedCardNotConfiguredError,
  ContentTypeNotSupportedError,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from '../../errors.js';
import {
  JSONRPCRequest,
  JSONRPCResponse,
  MessageSendParams,
  TaskPushNotificationConfig,
  TaskIdParams,
  ListTaskPushNotificationConfigParams,
  DeleteTaskPushNotificationConfigParams,
  DeleteTaskPushNotificationConfigResponse,
  TaskQueryParams,
  Task,
  JSONRPCErrorResponse,
  SendMessageSuccessResponse,
  SetTaskPushNotificationConfigSuccessResponse,
  GetTaskPushNotificationConfigSuccessResponse,
  ListTaskPushNotificationConfigSuccessResponse,
  GetTaskSuccessResponse,
  CancelTaskSuccessResponse,
} from '../../types.js';
import { A2AStreamEventData, SendMessageResult } from '../client.js';
import { A2ATransport } from './transport.js';

export interface JsonRpcTransportOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

export class JsonRpcTransport implements A2ATransport {
  private readonly customFetchImpl?: typeof fetch;
  private readonly endpoint: string;
  private requestIdCounter: number = 1;

  constructor(options: JsonRpcTransportOptions) {
    this.endpoint = options.endpoint;
    this.customFetchImpl = options.fetchImpl;
  }

  async sendMessage(params: MessageSendParams, idOverride?: number): Promise<SendMessageResult> {
    const rpcResponse = await this._sendRpcRequest<MessageSendParams, SendMessageSuccessResponse>(
      'message/send',
      params,
      idOverride
    );
    return rpcResponse.result;
  }

  async *sendMessageStream(
    params: MessageSendParams
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendStreamingRequest('message/stream', params);
  }

  async setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    idOverride?: number
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendRpcRequest<
      TaskPushNotificationConfig,
      SetTaskPushNotificationConfigSuccessResponse
    >('tasks/pushNotificationConfig/set', params, idOverride);
    return rpcResponse.result;
  }

  async getTaskPushNotificationConfig(
    params: TaskIdParams,
    idOverride?: number
  ): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendRpcRequest<
      TaskIdParams,
      GetTaskPushNotificationConfigSuccessResponse
    >('tasks/pushNotificationConfig/get', params, idOverride);
    return rpcResponse.result;
  }

  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigParams,
    idOverride?: number
  ): Promise<TaskPushNotificationConfig[]> {
    const rpcResponse = await this._sendRpcRequest<
      ListTaskPushNotificationConfigParams,
      ListTaskPushNotificationConfigSuccessResponse
    >('tasks/pushNotificationConfig/list', params, idOverride);
    return rpcResponse.result;
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams,
    idOverride?: number
  ): Promise<void> {
    await this._sendRpcRequest<
      DeleteTaskPushNotificationConfigParams,
      DeleteTaskPushNotificationConfigResponse
    >('tasks/pushNotificationConfig/delete', params, idOverride);
  }

  async getTask(params: TaskQueryParams, idOverride?: number): Promise<Task> {
    const rpcResponse = await this._sendRpcRequest<TaskQueryParams, GetTaskSuccessResponse>(
      'tasks/get',
      params,
      idOverride
    );
    return rpcResponse.result;
  }

  async cancelTask(params: TaskIdParams, idOverride?: number): Promise<Task> {
    const rpcResponse = await this._sendRpcRequest<TaskIdParams, CancelTaskSuccessResponse>(
      'tasks/cancel',
      params,
      idOverride
    );
    return rpcResponse.result;
  }

  async *resubscribeTask(
    params: TaskIdParams
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendStreamingRequest('tasks/resubscribe', params);
  }

  async callExtensionMethod<TExtensionParams, TExtensionResponse extends JSONRPCResponse>(
    method: string,
    params: TExtensionParams,
    idOverride: number
  ) {
    return await this._sendRpcRequest<TExtensionParams, TExtensionResponse>(
      method,
      params,
      idOverride
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

  private async _sendRpcRequest<
    TParams extends { [key: string]: any },
    TResponse extends JSONRPCResponse,
  >(method: string, params: TParams, idOverride: number | undefined): Promise<TResponse> {
    const requestId = idOverride ?? this.requestIdCounter++;

    const rpcRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      method,
      params: params,
      id: requestId,
    };

    const httpResponse = await this._fetchRpc(rpcRequest);

    if (!httpResponse.ok) {
      let errorBodyText = '(empty or non-JSON response)';
      let errorJson: any = {};
      try {
        errorBodyText = await httpResponse.text();
        errorJson = JSON.parse(errorBodyText);
      } catch (e: any) {
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

    const rpcResponse: JSONRPCResponse = await httpResponse.json();
    if (rpcResponse.id !== requestId) {
      console.error(
        `CRITICAL: RPC response ID mismatch for method ${method}. Expected ${requestId}, got ${rpcResponse.id}.`
      );
    }

    if ('error' in rpcResponse) {
      throw JsonRpcTransport.mapToError(rpcResponse);
    }

    return rpcResponse as TResponse;
  }

  private async _fetchRpc(
    rpcRequest: JSONRPCRequest,
    acceptHeader: string = 'application/json'
  ): Promise<Response> {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: acceptHeader,
      },
      body: JSON.stringify(rpcRequest),
    };
    return this._fetch(this.endpoint, requestInit);
  }

  private async *_sendStreamingRequest(
    method: string,
    params: any
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    const clientRequestId = this.requestIdCounter++;
    const rpcRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      method,
      params: params as { [key: string]: any },
      id: clientRequestId,
    };

    const response = await this._fetchRpc(rpcRequest, 'text/event-stream');

    if (!response.ok) {
      let errorBody = '';
      let errorJson: any = {};
      try {
        errorBody = await response.text();
        errorJson = JSON.parse(errorBody);
      } catch (e: any) {
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

    yield* this._parseA2ASseStream<A2AStreamEventData>(response, clientRequestId);
  }

  private async *_parseA2ASseStream<TStreamItem>(
    response: Response,
    originalRequestId: number | string | null
  ): AsyncGenerator<TStreamItem, void, undefined> {
    if (!response.body) {
      throw new Error('SSE response body is undefined. Cannot read stream.');
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let eventDataBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (eventDataBuffer.trim()) {
            const result = this._processSseEventData<TStreamItem>(
              eventDataBuffer,
              originalRequestId
            );
            yield result;
          }
          break;
        }

        buffer += value;
        let lineEndIndex;
        while ((lineEndIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.substring(0, lineEndIndex).trim();
          buffer = buffer.substring(lineEndIndex + 1);

          if (line === '') {
            if (eventDataBuffer) {
              const result = this._processSseEventData<TStreamItem>(
                eventDataBuffer,
                originalRequestId
              );
              yield result;
              eventDataBuffer = '';
            }
          } else if (line.startsWith('data:')) {
            eventDataBuffer += line.substring(5).trimStart() + '\n';
          }
        }
      }
    } catch (error: any) {
      console.error('Error reading or parsing SSE stream:', error.message);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private _processSseEventData<TStreamItem>(
    jsonData: string,
    originalRequestId: number | string | null
  ): TStreamItem {
    if (!jsonData.trim()) {
      throw new Error('Attempted to process empty SSE event data.');
    }
    try {
      const sseJsonRpcResponse = JSON.parse(jsonData.replace(/\n$/, ''));
      const a2aStreamResponse: JSONRPCResponse = sseJsonRpcResponse as JSONRPCResponse;

      if (a2aStreamResponse.id !== originalRequestId) {
        console.warn(
          `SSE Event's JSON-RPC response ID mismatch. Client request ID: ${originalRequestId}, event response ID: ${a2aStreamResponse.id}.`
        );
      }

      if ('error' in a2aStreamResponse) {
        const err = a2aStreamResponse.error;
        throw new Error(
          `SSE event contained an error: ${err.message} (Code: ${err.code}) Data: ${JSON.stringify(err.data || {})}`
        );
      }

      if (!('result' in a2aStreamResponse) || typeof a2aStreamResponse.result === 'undefined') {
        throw new Error(`SSE event JSON-RPC response is missing 'result' field. Data: ${jsonData}`);
      }

      return a2aStreamResponse.result as TStreamItem;
    } catch (e: any) {
      if (
        e.message.startsWith('SSE event contained an error') ||
        e.message.startsWith("SSE event JSON-RPC response is missing 'result' field")
      ) {
        throw e;
      }
      console.error(
        'Failed to parse SSE event data string or unexpected JSON-RPC structure:',
        jsonData,
        e
      );
      throw new Error(
        `Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${e.message}`
      );
    }
  }

  private static mapToError(response: JSONRPCErrorResponse): Error {
    switch (response.error.code) {
      case -32001:
        return new TaskNotFoundJSONRPCError(response);
      case -32002:
        return new TaskNotCancelableJSONRPCError(response);
      case -32003:
        return new PushNotificationNotSupportedJSONRPCError(response);
      case -32004:
        return new UnsupportedOperationJSONRPCError(response);
      case -32005:
        return new ContentTypeNotSupportedJSONRPCError(response);
      case -32006:
        return new InvalidAgentResponseJSONRPCError(response);
      case -32007:
        return new AuthenticatedExtendedCardNotConfiguredJSONRPCError(response);
      default:
        return new JSONRPCTransportError(response);
    }
  }
}

export class JSONRPCTransportError extends Error {
  constructor(public errorResponse: JSONRPCErrorResponse) {
    super(
      `JSON-RPC error: ${errorResponse.error.message} (Code: ${errorResponse.error.code}) Data: ${JSON.stringify(errorResponse.error.data || {})}`
    );
  }
}

// Redeclare domain errors with the original JSON-RPC response as a field to be compatible
// with the legacy A2AClient built around JSON-RPC interface.

export class TaskNotFoundJSONRPCError extends TaskNotFoundError {
  constructor(public errorResponse: JSONRPCErrorResponse) {
    super();
  }
}

export class TaskNotCancelableJSONRPCError extends TaskNotCancelableError {
  constructor(public errorResponse: JSONRPCErrorResponse) {
    super();
  }
}

export class PushNotificationNotSupportedJSONRPCError extends PushNotificationNotSupportedError {
  constructor(public errorResponse: JSONRPCErrorResponse) {
    super();
  }
}

export class UnsupportedOperationJSONRPCError extends UnsupportedOperationError {
  constructor(public errorResponse: JSONRPCErrorResponse) {
    super();
  }
}

export class ContentTypeNotSupportedJSONRPCError extends ContentTypeNotSupportedError {
  constructor(public errorResponse: JSONRPCErrorResponse) {
    super();
  }
}

export class InvalidAgentResponseJSONRPCError extends InvalidAgentResponseError {
  constructor(public errorResponse: JSONRPCErrorResponse) {
    super();
  }
}

export class AuthenticatedExtendedCardNotConfiguredJSONRPCError extends AuthenticatedExtendedCardNotConfiguredError {
  constructor(public errorResponse: JSONRPCErrorResponse) {
    super();
  }
}

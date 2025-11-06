import { AuthenticatedExtendedCardNotConfiguredError, ContentTypeNotSupportedError, InvalidAgentResponseError, PushNotificationNotSupportedError, TaskNotCancelableError, TaskNotFoundError, UnsupportedOperationError } from '../../server/error.js';
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
  JSONRPCSuccessResponse,
  JSONRPCError,
  A2ARequest,
} from '../../types.js';
import { A2AStreamEventData, SendMessageResult } from '../client.js';
import { A2ATransport } from './transport.js';

export interface JsonRpcTransportOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

export class JsonRpcTransport implements A2ATransport {
  private requestIdCounter: number = 1;
  private customFetchImpl?: typeof fetch;
  private endpoint: string

  constructor(options: JsonRpcTransportOptions) {
    this.endpoint = options.endpoint;
    this.customFetchImpl = options.fetchImpl;
  }

  async sendMessage(params: MessageSendParams, idOverride?: number): Promise<SendMessageResult> {
    const rpcResponse = await this._sendRpcRequest<MessageSendParams, SendMessageSuccessResponse>("message/send", params, idOverride);
    return rpcResponse.result;
  }

  async *sendMessageStream(params: MessageSendParams): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendStreamingRequest("message/stream", params);
  }

  async setTaskPushNotificationConfig(params: TaskPushNotificationConfig, idOverride?: number): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendRpcRequest<TaskPushNotificationConfig, SetTaskPushNotificationConfigSuccessResponse>("tasks/pushNotificationConfig/set", params, idOverride);
    return rpcResponse.result;
  }

  async getTaskPushNotificationConfig(params: TaskIdParams, idOverride?: number): Promise<TaskPushNotificationConfig> {
    const rpcResponse = await this._sendRpcRequest<TaskIdParams, GetTaskPushNotificationConfigSuccessResponse>("tasks/pushNotificationConfig/get", params, idOverride);
    return rpcResponse.result;
  }

  async listTaskPushNotificationConfig(params: ListTaskPushNotificationConfigParams, idOverride?: number): Promise<TaskPushNotificationConfig[]> {
    const rpcResponse = await this._sendRpcRequest<ListTaskPushNotificationConfigParams, ListTaskPushNotificationConfigSuccessResponse>("tasks/pushNotificationConfig/list", params, idOverride);
    return rpcResponse.result;
  }

  async deleteTaskPushNotificationConfig(params: DeleteTaskPushNotificationConfigParams, idOverride?: number): Promise<void> {
    await this._sendRpcRequest<DeleteTaskPushNotificationConfigParams, DeleteTaskPushNotificationConfigResponse>("tasks/pushNotificationConfig/delete", params, idOverride);
  }

  async getTask(params: TaskQueryParams, idOverride?: number): Promise<Task> {
    const rpcResponse = await this._sendRpcRequest<TaskQueryParams, GetTaskSuccessResponse>("tasks/get", params, idOverride);
    return rpcResponse.result;
  }

  async cancelTask(params: TaskIdParams, idOverride?: number): Promise<Task> {
    const rpcResponse = await this._sendRpcRequest<TaskIdParams, CancelTaskSuccessResponse>("tasks/cancel", params, idOverride);
    return rpcResponse.result;
  }

  async *resubscribeTask(params: TaskIdParams): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this._sendStreamingRequest("tasks/resubscribe", params);
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

  private async _sendRpcRequest<TParams, TResponse extends JSONRPCResponse>(
    method: string,
    params: TParams,
    idOverride: Id | undefined,
  ): Promise<TResponse> {
    const requestId = idOverride ?? this.requestIdCounter++;
    
    const rpcRequest: JSONRPCRequest = {
      jsonrpc: "2.0",
      method,
      params: params as { [key: string]: any; },
      id: requestId,
    };

    const httpResponse = await this._fetchRpc(rpcRequest);

    if (!httpResponse.ok) {
      let errorBodyText = '(empty or non-JSON response)';
      try {
        errorBodyText = await httpResponse.text();
        const errorJson: JSONRPCErrorResponse = JSON.parse(errorBodyText);
        if (errorJson.jsonrpc && errorJson.error) {
          throw JsonRpcTransport.mapToError(errorJson);
        } else if (!errorJson.jsonrpc && errorJson.error) {
          throw new Error(`RPC error for ${method}: ${errorJson.error.message} (Code: ${errorJson.error.code}, HTTP Status: ${httpResponse.status}) Data: ${JSON.stringify(errorJson.error.data || {})}`);
        } else {
          throw new Error(`HTTP error for ${method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`);
        }
      } catch (e: any) {
        if (e.message.startsWith('RPC error for') || e.message.startsWith('HTTP error for')) throw e;
        throw new Error(`HTTP error for ${method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`);
      }
    }

    const rpcResponse: JSONRPCSuccessResponse = await httpResponse.json();

    if (rpcResponse.id !== requestId) {
      console.error(`CRITICAL: RPC response ID mismatch for method ${method}. Expected ${requestId}, got ${rpcResponse.id}.`);
    }

    return rpcResponse as TResponse;
  }

  private async _fetchRpc(rpcRequest: JSONRPCRequest, acceptHeader: string = "application/json"): Promise<Response> {
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": acceptHeader,
      },
      body: JSON.stringify(rpcRequest)
    };
    return this._fetch(this.endpoint, requestInit);
  }

  private async *_sendStreamingRequest(
    method: string,
    params: any
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    const clientRequestId = this.requestIdCounter++;
    const rpcRequest: JSONRPCRequest = {
      jsonrpc: "2.0",
      method,
      params: params as { [key: string]: any; },
      id: clientRequestId,
    };

    const response = await this._fetchRpc(rpcRequest, "text/event-stream");

    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
        const errorJson = JSON.parse(errorBody);
        if (errorJson.error) {
          throw new Error(`HTTP error establishing stream for ${method}: ${response.status} ${response.statusText}. RPC Error: ${errorJson.error.message} (Code: ${errorJson.error.code})`);
        }
      } catch (e: any) {
        if (e.message.startsWith('HTTP error establishing stream')) throw e;
        throw new Error(`HTTP error establishing stream for ${method}: ${response.status} ${response.statusText}. Response: ${errorBody || '(empty)'}`);
      }
      throw new Error(`HTTP error establishing stream for ${method}: ${response.status} ${response.statusText}`);
    }
    if (!response.headers.get("Content-Type")?.startsWith("text/event-stream")) {
      throw new Error(`Invalid response Content-Type for SSE stream for ${method}. Expected 'text/event-stream'.`);
    }

    yield* this._parseA2ASseStream<A2AStreamEventData>(response, clientRequestId);
  }

  private async *_parseA2ASseStream<TStreamItem>(
    response: Response,
    originalRequestId: number | string | null
  ): AsyncGenerator<TStreamItem, void, undefined> {
    if (!response.body) {
      throw new Error("SSE response body is undefined. Cannot read stream.");
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let eventDataBuffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (eventDataBuffer.trim()) {
            const result = this._processSseEventData<TStreamItem>(eventDataBuffer, originalRequestId);
            yield result;
          }
          break;
        }

        buffer += value;
        let lineEndIndex;
        while ((lineEndIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.substring(0, lineEndIndex).trim();
          buffer = buffer.substring(lineEndIndex + 1);

          if (line === "") {
            if (eventDataBuffer) {
              const result = this._processSseEventData<TStreamItem>(eventDataBuffer, originalRequestId);
              yield result;
              eventDataBuffer = "";
            }
          } else if (line.startsWith("data:")) {
            eventDataBuffer += line.substring(5).trimStart() + "\n";
          }
        }
      }
    } catch (error: any) {
      console.error("Error reading or parsing SSE stream:", error.message);
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
      throw new Error("Attempted to process empty SSE event data.");
    }
    try {
      const sseJsonRpcResponse = JSON.parse(jsonData.replace(/\n$/, ''));
      const a2aStreamResponse: JSONRPCResponse = sseJsonRpcResponse as JSONRPCResponse;

      if (a2aStreamResponse.id !== originalRequestId) {
        console.warn(`SSE Event's JSON-RPC response ID mismatch. Client request ID: ${originalRequestId}, event response ID: ${a2aStreamResponse.id}.`);
      }

      if ("error" in a2aStreamResponse) {
        const err = a2aStreamResponse.error;
        throw new Error(`SSE event contained an error: ${err.message} (Code: ${err.code}) Data: ${JSON.stringify(err.data || {})}`);
      }

      if (!('result' in a2aStreamResponse) || typeof a2aStreamResponse.result === 'undefined') {
        throw new Error(`SSE event JSON-RPC response is missing 'result' field. Data: ${jsonData}`);
      }

      return a2aStreamResponse.result as TStreamItem;
    } catch (e: any) {
      if (e.message.startsWith("SSE event contained an error") || e.message.startsWith("SSE event JSON-RPC response is missing 'result' field")) {
        throw e;
      }
      console.error("Failed to parse SSE event data string or unexpected JSON-RPC structure:", jsonData, e);
      throw new Error(`Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${e.message}`);
    }
  }

  private static mapToError(response: JSONRPCErrorResponse): Error {
    switch (response.error.code) {
      case -32001:
        return new TaskNotFoundError();
      case -32002:
        return new TaskNotCancelableError();
      case -32003:
        return new PushNotificationNotSupportedError();
      case -32004:
        return new UnsupportedOperationError();
      case -32005:
        return new ContentTypeNotSupportedError();
      case -32006:
        return new InvalidAgentResponseError();
      case -32007:
        return new AuthenticatedExtendedCardNotConfiguredError();
      default:
        return new Error(`Unknown JSON-RPC error: ${response.error.message} (Code: ${response.error.code}) Data: ${JSON.stringify(response.error.data || {})}`)
    }
  }
}
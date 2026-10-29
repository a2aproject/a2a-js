/**
 * v0.3 HTTP+JSON (REST) client transport. Implements the v1.0 `Transport`
 * interface but speaks the v0.3 REST wire format.
 *
 * Request bodies are proto-JSON of the v0.3 proto types (per the
 * `google.api.http` annotations with `body: "*"`) — NOT the v0.3
 * JSON-RPC body shape. The reference SDKs (a2a-python, a2a-go) feed
 * REST bodies through `json_format` against the proto, so the proto-JSON
 * shape is the only one they accept.
 *
 * Wire differences from v1.0: `application/json` (no `application/a2a+json`),
 * paths under `/v1/...`, bare error bodies (no `google.rpc.Status`), and
 * REST SSE events carry the bare stream-result payload (no JSON-RPC
 * envelope). `listTasks` throws synchronously — v0.3 REST never exposed
 * `tasks/list`.
 */

import { A2A_ERROR_CLASSES } from '../../../../errors/base.js';
import { JSON_RPC_CODE_TO_ERROR } from '../../../../errors/json_rpc.js';
import { InvalidAgentResponseError, UnsupportedOperationError } from '../../../../errors/index.js';
import type { TransportProtocolName } from '../../../../core.js';
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
import { A2A_LEGACY_PROTOCOL_VERSION, LEGACY_JSON_CONTENT_TYPE } from '../../constants.js';
import { toCoreAgentCard } from '../../translate/agent_card.js';
import { toCoreMessage } from '../../translate/messages.js';
import {
  toCompatTaskPushNotificationConfig,
  toCoreTaskPushNotificationConfig,
} from '../../translate/push_notifications.js';
import {
  toCompatSendMessageRequest,
  toCoreListTaskPushNotificationConfigsResponse,
  toCoreStreamResponse,
} from '../../translate/requests.js';
import { toCoreTask } from '../../translate/tasks.js';
import type * as legacy from '../../types/types.js';
import {
  AgentCard as LegacyProtoAgentCard,
  SendMessageRequest as LegacyProtoSendMessageRequest,
  SendMessageResponse as LegacyProtoSendMessageResponse,
  StreamResponse as LegacyProtoStreamResponse,
  Task as LegacyProtoTask,
  TaskPushNotificationConfig as LegacyProtoTaskPushNotificationConfig,
  ListTaskPushNotificationConfigResponse as LegacyProtoListTaskPushNotificationConfigResponse,
} from '../../types/pb/a2a.js';
import { FromProto } from '../../types/converters/from_proto.js';
import { ToProto } from '../../types/converters/to_proto.js';

const PROTOCOL_NAME: TransportProtocolName = 'HTTP+JSON';

export interface LegacyRestTransportOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

// v0.3 returned errors as bare `{ code, message, data? }` objects.
interface LegacyRestErrorBody {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export class LegacyRestTransport implements Transport {
  private readonly customFetchImpl?: typeof fetch;
  private readonly endpoint: string;
  private requestIdCounter: number = 1;

  constructor(options: LegacyRestTransportOptions) {
    // Strip trailing slashes for path consistency, matching v1.0.
    this.endpoint = options.endpoint.replace(/\/+$/, '');
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
    const protoCard = await this._sendRequestJson(
      'GET',
      '/v1/card',
      undefined,
      LegacyProtoAgentCard,
      options
    );
    return toCoreAgentCard(FromProto.agentCard(protoCard));
  }

  async sendMessage(
    params: V1SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const body = this._buildSendMessageRequestJson(params);
    const result = await this._sendRequestJson(
      'POST',
      '/v1/message:send',
      body,
      LegacyProtoSendMessageResponse,
      options
    );
    return LegacyRestTransport._parseProtoSendMessageResult(result);
  }

  async *sendMessageStream(
    params: V1SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
    const body = this._buildSendMessageRequestJson(params);
    yield* this._sendStreamingRequest('/v1/message:stream', 'POST', body, options);
  }

  async createTaskPushNotificationConfig(
    params: V1TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<V1TaskPushNotificationConfig> {
    // Path embeds the task id; body is the proto-JSON of the parent
    // `TaskPushNotificationConfig` (per the proto's `body: "*"`).
    const protoConfig = ToProto.taskPushNotificationConfig(
      toCompatTaskPushNotificationConfig(params)
    );
    const body = LegacyProtoTaskPushNotificationConfig.toJSON(protoConfig);
    const path = `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`;
    const result = await this._sendRequestJson(
      'POST',
      path,
      body,
      LegacyProtoTaskPushNotificationConfig,
      options
    );
    return toCoreTaskPushNotificationConfig(FromProto.taskPushNotificationConfig(result));
  }

  async getTaskPushNotificationConfig(
    params: V1GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<V1TaskPushNotificationConfig> {
    const path =
      `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/` +
      encodeURIComponent(params.id);
    const result = await this._sendRequestJson(
      'GET',
      path,
      undefined,
      LegacyProtoTaskPushNotificationConfig,
      options
    );
    return toCoreTaskPushNotificationConfig(FromProto.taskPushNotificationConfig(result));
  }

  async listTaskPushNotificationConfig(
    params: V1ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<V1ListTaskPushNotificationConfigsResponse> {
    const path = `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`;
    // v0.3 returns a `ListTaskPushNotificationConfigResponse` wrapper with
    // a `configs[]` field — not a bare JSON array.
    const result = await this._sendRequestJson(
      'GET',
      path,
      undefined,
      LegacyProtoListTaskPushNotificationConfigResponse,
      options
    );
    const protoConfigs = result?.configs ?? [];
    const legacyConfigs = protoConfigs.map((c) => FromProto.taskPushNotificationConfig(c));
    return toCoreListTaskPushNotificationConfigsResponse({
      id: this._nextResponseId(),
      jsonrpc: '2.0',
      result: legacyConfigs,
    });
  }

  async deleteTaskPushNotificationConfig(
    params: V1DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void> {
    const path =
      `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/` +
      encodeURIComponent(params.id);
    await this._sendRequestJson('DELETE', path, undefined, undefined, options);
  }

  async getTask(params: V1GetTaskRequest, options?: RequestOptions): Promise<V1Task> {
    const queryParams = new URLSearchParams();
    if (params.historyLength !== undefined) {
      queryParams.set('historyLength', String(params.historyLength));
    }
    const queryString = queryParams.toString();
    const path = `/v1/tasks/${encodeURIComponent(params.id)}${queryString ? `?${queryString}` : ''}`;
    const result = await this._sendRequestJson('GET', path, undefined, LegacyProtoTask, options);
    return toCoreTask(FromProto.task(result));
  }

  async cancelTask(params: V1CancelTaskRequest, options?: RequestOptions): Promise<V1Task> {
    const path = `/v1/tasks/${encodeURIComponent(params.id)}:cancel`;
    const result = await this._sendRequestJson('POST', path, undefined, LegacyProtoTask, options);
    return toCoreTask(FromProto.task(result));
  }

  /** `tasks/list` has no REST binding in v0.3. Throws synchronously. */
  async listTasks(
    _params: V1ListTasksRequest,
    _options?: RequestOptions
  ): Promise<V1ListTasksResponse> {
    throw new UnsupportedOperationError('tasks/list has no equivalent in v0.3 HTTP+JSON');
  }

  async *resubscribeTask(
    params: V1SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
    const path = `/v1/tasks/${encodeURIComponent(params.id)}:subscribe`;
    // GET, not POST: the v0.3 proto annotates `SubscribeToTask` with
    // `get: "/v1/tasks/{id}:subscribe"` and a2a-python only registers
    // GET, so POST yields 405.
    yield* this._sendStreamingRequest(path, 'GET', undefined, options);
  }

  /**
   * v1.0 `SendMessageRequest` → proto-JSON body of the v0.3
   * `SendMessageRequest` proto. The `requestId` is never seen on the
   * wire — we only consume `.params` — but the translator requires one.
   */
  private _buildSendMessageRequestJson(core: V1SendMessageRequest): unknown {
    const envelope = toCompatSendMessageRequest(core, this.requestIdCounter++);
    const protoRequest = ToProto.messageSendParams(envelope.params);
    return LegacyProtoSendMessageRequest.toJSON(protoRequest);
  }

  // ID for synthetic envelopes consumed by translators. Never on the wire.
  private _nextResponseId(): number {
    return this.requestIdCounter++;
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
        'Please provide a `fetchImpl` in the LegacyRestTransportOptions.'
    );
  }

  private _buildHeaders(
    options: RequestOptions | undefined,
    acceptHeader: string = LEGACY_JSON_CONTENT_TYPE
  ): HeadersInit {
    return {
      ...options?.serviceParameters,
      'Content-Type': LEGACY_JSON_CONTENT_TYPE,
      Accept: acceptHeader,
    };
  }

  /**
   * Issues a non-streaming request and decodes the response as proto-JSON
   * of `responseType` (pass `undefined` for `DELETE` / 204).
   */
  private async _sendRequestJson<TResponse>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown | undefined,
    responseType: { fromJSON(object: unknown): TResponse } | undefined,
    options: RequestOptions | undefined
  ): Promise<TResponse> {
    const url = `${this.endpoint}${path}`;
    const requestInit: RequestInit = {
      method,
      headers: this._buildHeaders(options),
      signal: options?.signal,
    };

    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      requestInit.body = JSON.stringify(body);
    }

    const response = await this._fetch(url, requestInit);

    if (!response.ok) {
      await LegacyRestTransport._handleErrorResponse(response, path);
    }

    if (response.status === 204 || responseType === undefined) {
      return undefined as TResponse;
    }

    const text = await response.text();
    if (!text) {
      return undefined as TResponse;
    }
    const json = JSON.parse(text);
    return responseType.fromJSON(json);
  }

  private async *_sendStreamingRequest(
    path: string,
    method: 'GET' | 'POST',
    body: unknown | undefined,
    options?: RequestOptions
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
    const url = `${this.endpoint}${path}`;
    const requestInit: RequestInit = {
      method,
      headers: this._buildHeaders(options, 'text/event-stream'),
      signal: options?.signal,
    };

    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }

    const response = await this._fetch(url, requestInit);

    if (!response.ok) {
      await LegacyRestTransport._handleErrorResponse(response, path);
    }

    const contentType = response.headers.get('Content-Type');
    if (!contentType?.startsWith('text/event-stream')) {
      throw new Error(
        `Invalid response Content-Type for SSE stream. Expected 'text/event-stream', got '${contentType}'.`
      );
    }

    for await (const event of parseSseStream(response)) {
      if (event.type === 'error') {
        throw LegacyRestTransport._parseSseErrorEvent(event.data);
      }
      yield LegacyRestTransport._processSseEventData(event.data);
    }
  }

  /**
   * v0.3 REST SSE emits the proto-JSON of `StreamResponse` directly —
   * no JSON-RPC envelope.
   */
  private static _processSseEventData(jsonData: string): V1StreamResponse {
    if (!jsonData.trim()) {
      throw new Error('Attempted to process empty SSE event data.');
    }

    let protoEnvelope: LegacyProtoStreamResponse;
    try {
      protoEnvelope = LegacyProtoStreamResponse.fromJSON(JSON.parse(jsonData));
    } catch (e) {
      throw new Error(
        `Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${(e instanceof Error && e.message) || 'Unknown error'}`,
        { cause: e }
      );
    }

    if (!protoEnvelope.payload) {
      throw new InvalidAgentResponseError('Invalid SSE event: v0.3 StreamResponse has no payload.');
    }

    let legacyResult: legacy.SendStreamingMessageSuccessResponse['result'];
    switch (protoEnvelope.payload.$case) {
      case 'task':
        legacyResult = FromProto.task(protoEnvelope.payload.value);
        break;
      case 'msg': {
        const m = FromProto.message(protoEnvelope.payload.value);
        if (!m) {
          throw new InvalidAgentResponseError('Invalid SSE event: v0.3 message payload is empty.');
        }
        legacyResult = m;
        break;
      }
      case 'statusUpdate':
        legacyResult = FromProto.taskStatusUpdateEvent(protoEnvelope.payload.value);
        break;
      case 'artifactUpdate':
        legacyResult = FromProto.taskArtifactUpdateEvent(protoEnvelope.payload.value);
        break;
      default:
        throw new InvalidAgentResponseError(
          `Unexpected v0.3 StreamResponse payload case: ${String(
            (protoEnvelope.payload as { $case?: string }).$case
          )}`
        );
    }

    return toCoreStreamResponse({ id: null, jsonrpc: '2.0', result: legacyResult });
  }

  /** Maps an SSE `error` payload to a typed SDK error. */
  private static _parseSseErrorEvent(jsonData: string): Error {
    try {
      const parsed = JSON.parse(jsonData) as unknown;
      if (LegacyRestTransport._isLegacyRestErrorBody(parsed)) {
        return LegacyRestTransport._errorFromLegacyBody(parsed);
      }
      return new Error(`SSE error event: ${jsonData}`);
    } catch {
      return new Error(`SSE error event (unparseable): ${jsonData}`);
    }
  }

  /** Maps a v0.3 error body to a typed SDK error, or falls back to a generic `Error`. */
  private static async _handleErrorResponse(response: Response, path: string): Promise<never> {
    let errorBodyText = '(empty or non-JSON response)';
    let errorBody: LegacyRestErrorBody | undefined;

    try {
      errorBodyText = await response.text();
      if (errorBodyText) {
        const parsed = JSON.parse(errorBodyText) as unknown;
        if (LegacyRestTransport._isLegacyRestErrorBody(parsed)) {
          errorBody = parsed;
        }
      }
    } catch {
      // JSON parse failed — fall through to generic error
    }

    if (errorBody) {
      throw LegacyRestTransport._errorFromLegacyBody(errorBody);
    }

    throw new Error(
      `HTTP error for ${path}! Status: ${response.status} ${response.statusText}. Response: ${errorBodyText}`
    );
  }

  /**
   * Reconstructs a semantic SDK error from a v0.3 error body. Unknown
   * codes fall through to a generic `Error` preserving the code/data
   * in the message for debugging.
   */
  private static _errorFromLegacyBody(body: LegacyRestErrorBody): Error {
    const name = JSON_RPC_CODE_TO_ERROR[body.code];
    if (name) return new A2A_ERROR_CLASSES[name]({ message: body.message });
    const dataSuffix = body.data ? ` Data: ${JSON.stringify(body.data)}` : '';
    return new Error(`REST error: ${body.message} (Code: ${body.code})${dataSuffix}`);
  }

  private static _isLegacyRestErrorBody(value: unknown): value is LegacyRestErrorBody {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { code?: unknown }).code === 'number' &&
      typeof (value as { message?: unknown }).message === 'string'
    );
  }

  /**
   * v0.3 REST returns the proto `SendMessageResponse` envelope (with the
   * `task | msg` oneof) directly, not a bare `Task | Message`.
   */
  private static _parseProtoSendMessageResult(
    response: LegacyProtoSendMessageResponse | undefined
  ): SendMessageResult {
    if (!response || !response.payload) {
      throw new InvalidAgentResponseError(
        'Invalid response: v0.3 message:send response payload is missing.'
      );
    }
    if (response.payload.$case === 'task') {
      return toCoreTask(FromProto.task(response.payload.value));
    }
    if (response.payload.$case === 'msg') {
      const legacyMessage = FromProto.message(response.payload.value);
      if (!legacyMessage) {
        throw new InvalidAgentResponseError(
          'Invalid response: v0.3 message:send returned an empty Message payload.'
        );
      }
      return toCoreMessage(legacyMessage);
    }
    throw new InvalidAgentResponseError(
      `Unexpected v0.3 SendMessageResponse payload case: ${String(
        (response.payload as { $case?: string }).$case
      )}`
    );
  }
}

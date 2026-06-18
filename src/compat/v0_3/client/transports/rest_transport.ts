/**
 * v0.3 HTTP+JSON (REST) client transport (compat layer).
 *
 * Implements the v1.0 {@link Transport} interface but speaks the v0.3 REST
 * wire format. Request bodies are serialized as **proto-JSON** of the v0.3
 * proto types (per `google.api.http` annotations on the v0.3 a2a.proto:
 * the REST surface is the same A2AService methods exposed via Google's
 * HTTP transcoding rules, with `body: "*"` mapping the whole proto-JSON
 * payload onto the HTTP body). Responses are decoded with the matching
 * `fromJSON` and then converted back to the v1.0 proto types via the
 * `FromProto.*` helpers.
 *
 * This is intentionally NOT the v0.3 JSON-RPC body shape (with `kind`
 * discriminators on parts and `parts` instead of `content`): the v0.3
 * reference SDKs' REST handlers (a2a-python's `A2ARESTFastAPIApplication`,
 * a2a-go's REST router) feed the body through Google's `json_format`
 * parser against `a2a.v1.SendMessageRequest`, so they only accept the
 * proto-JSON shape.
 *
 * Shares `protocolName === 'HTTP+JSON'` with the v1.0 transport. The
 * core-side {@link RestTransportFactory} inspects the matched
 * `AgentInterface.protocolVersion` and instantiates this class when it
 * falls in `[0.3, 1.0)`, so installing the default `RestTransportFactory`
 * with `legacyCompat: { enabled: true }` transparently covers both
 * protocol versions.
 *
 * v0.3 wire-format differences from v1.0:
 *   - Content-Type / Accept are `application/json` (v0.3 did not introduce
 *     the `application/a2a+json` media type).
 *   - All paths live under `/v1/...` (the canonical v0.3 reference URLs).
 *   - Bodies and responses are proto-JSON of the v0.3 proto types
 *     (different from v1.0's proto-JSON only by the field-name and
 *     message-type set the v0.3 proto exposes).
 *   - Error bodies are bare `{ code, message, data? }` objects with no
 *     outer `{ error: {...} }` wrapper, no `status` field, and no
 *     `details[]` array — `google.rpc.Status` was a v1.0 addition.
 *   - REST SSE events carry only the bare v0.3 stream-result payload
 *     (proto-JSON of `StreamResponse`) with no JSON-RPC envelope.
 *
 * `listTasks` has no equivalent in v0.3 HTTP+JSON (per
 * {@link V1_METHODS_WITHOUT_LEGACY_EQUIVALENT}: the v0.3 REST surface
 * never exposed `tasks/list`). Calling it throws
 * {@link UnsupportedOperationError} synchronously, without issuing any
 * HTTP request.
 */

import {
  InvalidAgentResponseError,
  mapA2aErrorToSdkError,
  UnsupportedOperationError,
} from '../../../../errors.js';
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

/**
 * v0.3-shaped HTTP error body.
 *
 * Mirrors `LegacyRestErrorBody` on the server side: v0.3 returned errors
 * as bare `{ code, message, data? }` objects (no `details[]` array, no
 * `status` field, no outer `{ error: {...} }` wrapper).
 */
interface LegacyRestErrorBody {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * v0.3 REST client transport. See the file-level comment for the overall
 * design.
 */
export class LegacyRestTransport implements Transport {
  private readonly customFetchImpl?: typeof fetch;
  private readonly endpoint: string;
  private requestIdCounter: number = 1;

  constructor(options: LegacyRestTransportOptions) {
    // Match v1.0 RestTransport: strip trailing slashes so callers can pass
    // either `https://host/api` or `https://host/api/` and get identical
    // paths.
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
    // The REST path embeds the task id (per the v0.3 google.api.http
    // annotation); the body is the proto-JSON of the parent
    // `TaskPushNotificationConfig` (per `body: "*"`).
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
    // v0.3 REST `list` returns the proto-JSON of
    // `ListTaskPushNotificationConfigResponse` (a wrapper with a
    // `configs[]` repeated field), not a bare JSON array. Decode via
    // the proto's `fromJSON` and unwrap.
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

  /**
   * `tasks/list` has no REST binding in v0.3 (per
   * {@link V1_METHODS_WITHOUT_LEGACY_EQUIVALENT}). Throws synchronously
   * without issuing an HTTP request.
   */
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
    // GET, not POST: the v0.3 proto's `google.api.http` annotation for
    // `SubscribeToTask` maps to `get: "/v1/tasks/{id}:subscribe"` (no
    // request body), and a2a-python's `A2ARESTFastAPIApplication` only
    // registers the GET method. Some baselines (a2a-python's v0.3 compat
    // adapter at `src/a2a/compat/v0_3/rest_adapter.py`) additionally
    // accept POST for tolerance, but the canonical reference does not —
    // sending POST yields 405 Method Not Allowed.
    yield* this._sendStreamingRequest(path, 'GET', undefined, options);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /**
   * Translates v1.0 `SendMessageRequest` into a proto-JSON body of the
   * v0.3 `SendMessageRequest` proto message (the canonical wire format
   * for the v0.3 REST surface, per the proto's `google.api.http`
   * annotation with `body: "*"`).
   *
   * Pipeline:
   *   1. v1.0 `SendMessageRequest` → v0.3 `legacy.MessageSendParams`
   *      via `toCompatSendMessageRequest` (we only need the
   *      `.params` payload; REST never carries the JSON-RPC envelope).
   *   2. `legacy.MessageSendParams` → v0.3 proto `SendMessageRequest`
   *      via `ToProto.messageSendParams`.
   *   3. v0.3 proto `SendMessageRequest` → proto-JSON via
   *      `SendMessageRequest.toJSON`.
   *
   * The `requestId` passed to `toCompatSendMessageRequest` is irrelevant
   * since we only consume `.params`; we use the same counter as JSON-RPC
   * for symmetry but never see the value on the wire.
   */
  private _buildSendMessageRequestJson(core: V1SendMessageRequest): unknown {
    const envelope = toCompatSendMessageRequest(core, this.requestIdCounter++);
    const protoRequest = ToProto.messageSendParams(envelope.params);
    return LegacyProtoSendMessageRequest.toJSON(protoRequest);
  }

  /**
   * Allocates a response ID for envelopes that need one for translator
   * purposes (e.g. wrapping a bare list response so
   * `toCoreListTaskPushNotificationConfigsResponse` can consume it). The
   * value never appears on the v0.3 REST wire.
   */
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
   * Issues a non-streaming HTTP request against the v0.3 REST surface
   * and decodes the response as proto-JSON of the given proto type.
   *
   * - `body` is JSON-serialized as-is (callers pass the already-encoded
   *   proto-JSON document via the proto's `toJSON`). Skipped for `GET`
   *   and `DELETE`.
   * - `responseType` is the v0.3 proto descriptor (`{ fromJSON, ... }`)
   *   used to decode the response body. Pass `undefined` for endpoints
   *   that return no body (`DELETE`).
   * - 204 No Content resolves to `undefined`.
   * - Non-2xx responses with a parseable v0.3 error body are mapped to a
   *   typed SDK error via {@link mapA2aErrorToSdkError}; everything else
   *   falls through to a generic `Error`.
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
   * Translates a v0.3 SSE event payload (proto-JSON of `StreamResponse`)
   * into a v1.0 `StreamResponse`.
   *
   * REST SSE in v0.3 emits the proto-JSON of `StreamResponse` directly
   * — no JSON-RPC envelope. We decode via `StreamResponse.fromJSON` and
   * then translate each proto oneof branch through the legacy types to
   * the v1.0 proto via `toCoreStreamResponse`.
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

  /**
   * Maps an SSE `error`-typed event payload to a typed SDK error. The
   * payload should be a bare v0.3 error body
   * (`{ code, message, data? }`); falls back to a generic `Error` on
   * shape mismatch.
   */
  private static _parseSseErrorEvent(jsonData: string): Error {
    try {
      const parsed = JSON.parse(jsonData) as unknown;
      if (LegacyRestTransport._isLegacyRestErrorBody(parsed)) {
        return mapA2aErrorToSdkError(parsed, () => {
          const dataSuffix = parsed.data ? ` Data: ${JSON.stringify(parsed.data)}` : '';
          return new Error(`REST error: ${parsed.message} (Code: ${parsed.code})${dataSuffix}`);
        });
      }
      return new Error(`SSE error event: ${jsonData}`);
    } catch {
      return new Error(`SSE error event (unparseable): ${jsonData}`);
    }
  }

  /**
   * Reads an error response body and throws a typed SDK error.
   *
   * v0.3 wire shape is a bare `{ code, message, data? }` JSON object. If
   * the body parses to that shape, we map via {@link mapA2aErrorToSdkError};
   * otherwise we throw a generic `Error` with the HTTP status and the
   * raw body text for debuggability. Mirrors `RestTransport`'s v1.0
   * equivalent but uses the bare body shape rather than
   * `{ error: { code, status, message, details } }`.
   */
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
      const body = errorBody;
      throw mapA2aErrorToSdkError(body, () => {
        const dataSuffix = body.data ? ` Data: ${JSON.stringify(body.data)}` : '';
        return new Error(`REST error: ${body.message} (Code: ${body.code})${dataSuffix}`);
      });
    }

    throw new Error(
      `HTTP error for ${path}! Status: ${response.status} ${response.statusText}. Response: ${errorBodyText}`
    );
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
   * Parses a proto-JSON-decoded v0.3 `SendMessageResponse` (a
   * `oneof payload { task | msg }` envelope) into a v1.0
   * {@link SendMessageResult}. v0.3 REST returns the proto envelope
   * directly (per `body: "*"`), not a bare `Task | Message`.
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

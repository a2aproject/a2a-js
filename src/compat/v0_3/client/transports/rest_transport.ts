/**
 * v0.3 HTTP+JSON (REST) client transport (compat layer).
 *
 * Implements the v1.0 {@link Transport} interface but speaks the v0.3 REST
 * wire format. Each method translates the v1.0 proto request to v0.3 JSON
 * via the `toCompat*` helpers in `../../translate/requests.js`, issues an
 * HTTP request against the canonical v0.3 reference URLs
 * (`/v1/message:send`, `/v1/tasks/:taskId`, …), then translates the v0.3
 * response back to v1.0 proto via the corresponding `toCore*` helpers.
 *
 * Shares `protocolName === 'HTTP+JSON'` with the v1.0 transport. The
 * core-side {@link RestTransportFactory} inspects the matched
 * `AgentInterface.protocolVersion` and lazy-loads this class when it falls
 * in `[0.3, 1.0)`, so installing the default `RestTransportFactory` with
 * `legacyCompat: { enabled: true }` transparently covers both protocol
 * versions.
 *
 * v0.3 wire-format differences from v1.0:
 *   - Content-Type / Accept are `application/json` (v0.3 did not introduce
 *     the `application/a2a+json` media type).
 *   - All paths live under `/v1/...` (the canonical v0.3 reference URLs).
 *   - Error bodies are bare `{ code, message, data? }` objects with no
 *     outer `{ error: {...} }` wrapper, no `status` field, and no
 *     `details[]` array — `google.rpc.Status` was a v1.0 addition.
 *   - REST SSE events carry only the bare v0.3 stream-result payload
 *     (`Task | Message | TaskStatusUpdateEvent | TaskArtifactUpdateEvent`)
 *     with no JSON-RPC envelope.
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
    const card = await this._sendRequest<legacy.AgentCard>('GET', '/v1/card', undefined, options);
    return toCoreAgentCard(card);
  }

  async sendMessage(
    params: V1SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const body = this._buildSendMessageParams(params);
    const result = await this._sendRequest<legacy.Task | legacy.Message>(
      'POST',
      '/v1/message:send',
      body,
      options
    );
    return LegacyRestTransport._parseSendMessageResult(result);
  }

  async *sendMessageStream(
    params: V1SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
    const body = this._buildSendMessageParams(params);
    yield* this._sendStreamingRequest('/v1/message:stream', body, options);
  }

  async createTaskPushNotificationConfig(
    params: V1TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<V1TaskPushNotificationConfig> {
    const body = toCompatTaskPushNotificationConfig(params);
    const path = `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`;
    const result = await this._sendRequest<legacy.TaskPushNotificationConfig>(
      'POST',
      path,
      body,
      options
    );
    return toCoreTaskPushNotificationConfig(result);
  }

  async getTaskPushNotificationConfig(
    params: V1GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<V1TaskPushNotificationConfig> {
    const path =
      `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/` +
      encodeURIComponent(params.id);
    const result = await this._sendRequest<legacy.TaskPushNotificationConfig>(
      'GET',
      path,
      undefined,
      options
    );
    return toCoreTaskPushNotificationConfig(result);
  }

  async listTaskPushNotificationConfig(
    params: V1ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<V1ListTaskPushNotificationConfigsResponse> {
    const path = `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`;
    const result = await this._sendRequest<legacy.TaskPushNotificationConfig[]>(
      'GET',
      path,
      undefined,
      options
    );
    // Wrap the bare list response into the v0.3 success-response shape
    // that `toCoreListTaskPushNotificationConfigsResponse` expects.
    return toCoreListTaskPushNotificationConfigsResponse({
      id: this._nextResponseId(),
      jsonrpc: '2.0',
      result: result ?? [],
    });
  }

  async deleteTaskPushNotificationConfig(
    params: V1DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void> {
    const path =
      `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/` +
      encodeURIComponent(params.id);
    await this._sendRequest<void>('DELETE', path, undefined, options);
  }

  async getTask(params: V1GetTaskRequest, options?: RequestOptions): Promise<V1Task> {
    const queryParams = new URLSearchParams();
    if (params.historyLength !== undefined) {
      queryParams.set('historyLength', String(params.historyLength));
    }
    const queryString = queryParams.toString();
    const path = `/v1/tasks/${encodeURIComponent(params.id)}${queryString ? `?${queryString}` : ''}`;
    const result = await this._sendRequest<legacy.Task>('GET', path, undefined, options);
    return toCoreTask(result);
  }

  async cancelTask(params: V1CancelTaskRequest, options?: RequestOptions): Promise<V1Task> {
    const path = `/v1/tasks/${encodeURIComponent(params.id)}:cancel`;
    const result = await this._sendRequest<legacy.Task>('POST', path, undefined, options);
    return toCoreTask(result);
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
    yield* this._sendStreamingRequest(path, undefined, options);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /**
   * Translates v1.0 `SendMessageRequest` into v0.3 `MessageSendParams` by
   * leaning on `toCompatSendMessageRequest` (which builds the full v0.3
   * JSON-RPC envelope) and extracting its `.params` field. REST does not
   * carry the JSON-RPC envelope — only the params payload is sent as the
   * HTTP body.
   *
   * The `requestId` passed to `toCompatSendMessageRequest` is irrelevant
   * since we only consume `.params`; we use the same counter as JSON-RPC
   * for symmetry but never see the value on the wire.
   */
  private _buildSendMessageParams(core: V1SendMessageRequest): legacy.MessageSendParams {
    const envelope = toCompatSendMessageRequest(core, this.requestIdCounter++);
    return envelope.params;
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
   * Issues a non-streaming HTTP request against the v0.3 REST surface.
   *
   * - `body` is JSON-serialized as-is (already in v0.3 shape from the
   *   caller's translator). Skipped for `GET`/`DELETE`.
   * - 204 No Content (e.g. `DELETE`) resolves to `undefined`.
   * - Non-2xx responses with a parseable v0.3 error body are mapped to a
   *   typed SDK error via {@link mapA2aErrorToSdkError}; everything else
   *   falls through to a generic `Error`.
   */
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

    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      requestInit.body = JSON.stringify(body);
    }

    const response = await this._fetch(url, requestInit);

    if (!response.ok) {
      await LegacyRestTransport._handleErrorResponse(response, path);
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as TResponse;
  }

  private async *_sendStreamingRequest(
    path: string,
    body: unknown | undefined,
    options?: RequestOptions
  ): AsyncGenerator<V1StreamResponse, void, undefined> {
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
   * Translates a bare v0.3 SSE event payload into a v1.0 `StreamResponse`.
   *
   * REST SSE in v0.3 does not wrap events in a JSON-RPC envelope — the
   * `data:` field is the bare stream-result payload. We re-wrap it into a
   * minimal v0.3 success-response envelope so we can reuse
   * `toCoreStreamResponse` (which expects the envelope shape).
   */
  private static _processSseEventData(jsonData: string): V1StreamResponse {
    if (!jsonData.trim()) {
      throw new Error('Attempted to process empty SSE event data.');
    }

    type LegacyStreamResult = legacy.SendStreamingMessageSuccessResponse['result'];
    let result: LegacyStreamResult;
    try {
      result = JSON.parse(jsonData) as LegacyStreamResult;
    } catch (e) {
      throw new Error(
        `Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${(e instanceof Error && e.message) || 'Unknown error'}`,
        { cause: e }
      );
    }

    return toCoreStreamResponse({ id: null, jsonrpc: '2.0', result });
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
   * Parses the v0.3 `message/send` result into a v1.0
   * {@link SendMessageResult}. v0.3 used a discriminated union with a
   * `kind: 'task' | 'message'` field; we use that to pick the right
   * translator. Mirrors
   * {@link LegacyJsonRpcTransport._parseSendMessageResult}.
   */
  private static _parseSendMessageResult(result: legacy.Task | legacy.Message): SendMessageResult {
    if (!result) {
      throw new InvalidAgentResponseError('Invalid response: v0.3 message:send result is missing.');
    }
    if (result.kind === 'task') {
      return toCoreTask(result);
    }
    if (result.kind === 'message') {
      return toCoreMessage(result);
    }
    throw new InvalidAgentResponseError(
      `Unexpected v0.3 message:send result kind: ${String((result as { kind?: string }).kind)}`
    );
  }
}

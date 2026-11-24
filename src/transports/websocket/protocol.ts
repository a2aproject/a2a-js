import type { JSONRPCError, JSONRPCErrorResponse } from '../../core.js';
import { A2A_ERROR_DOMAIN, ERROR_INFO_TYPE, type A2AErrorInfo } from '../../errors/base.js';

/** The Agent Card protocolBinding value defined by the WebSocket binding. */
export const WEBSOCKET_PROTOCOL_NAME =
  'https://a2a-protocol.org/bindings/experimental-websocket/v1' as const;

/** The RFC 6455 sub-protocol negotiated by A2A WebSocket peers. */
export const WEBSOCKET_SUBPROTOCOL = 'a2a.v1' as const;

export const WEBSOCKET_JSONRPC_VERSION = '2.0' as const;
export const DEFAULT_WEBSOCKET_MAX_MESSAGE_BYTES = 1 << 20;

/** The version a connection uses when the client sends no `A2A-Version`. */
export const WEBSOCKET_DEFAULT_A2A_VERSION = '0.3' as const;

export const WEBSOCKET_CLOSE_CODE = {
  NORMAL_CLOSURE: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  INVALID_PAYLOAD: 1007,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  INTERNAL_ERROR: 1011,
  TRY_AGAIN_LATER: 1013,
  A2A_PROTOCOL_ERROR: 4000,
  AUTHENTICATION_REQUIRED: 4001,
  VERSION_NOT_SUPPORTED: 4002,
} as const;

/** JSON-RPC code shared by every binding-specific error. */
export const WEBSOCKET_SERVER_ERROR_CODE = -32000;

/** `ErrorInfo.reason` values of the binding-specific errors. */
export const WEBSOCKET_BINDING_ERROR = {
  UNAUTHENTICATED: 'WS_UNAUTHENTICATED',
  CREDENTIALS_EXPIRED: 'WS_CREDENTIALS_EXPIRED',
  PERMISSION_DENIED: 'WS_PERMISSION_DENIED',
  RATE_LIMITED: 'WS_RATE_LIMITED',
  TOO_MANY_IN_FLIGHT: 'WS_TOO_MANY_IN_FLIGHT',
} as const;

export type WebSocketBindingErrorReason =
  (typeof WEBSOCKET_BINDING_ERROR)[keyof typeof WEBSOCKET_BINDING_ERROR];

/** Method prefix reserved for the binding's control messages. */
export const WEBSOCKET_CONTROL_PREFIX = 'ws/' as const;

/** The binding's control methods. All but `AUTHENTICATE` are notifications. */
export const WEBSOCKET_CONTROL_METHOD = {
  STREAM_END: 'ws/StreamEnd',
  CANCEL_STREAM: 'ws/CancelStream',
  REAUTHENTICATION_REQUIRED: 'ws/ReauthenticationRequired',
  AUTHENTICATE: 'ws/Authenticate',
} as const;

export const WEBSOCKET_METHOD = {
  SEND_MESSAGE: 'SendMessage',
  SEND_STREAMING_MESSAGE: 'SendStreamingMessage',
  GET_TASK: 'GetTask',
  LIST_TASKS: 'ListTasks',
  CANCEL_TASK: 'CancelTask',
  SUBSCRIBE_TO_TASK: 'SubscribeToTask',
  CREATE_PUSH_CONFIG: 'CreateTaskPushNotificationConfig',
  GET_PUSH_CONFIG: 'GetTaskPushNotificationConfig',
  LIST_PUSH_CONFIGS: 'ListTaskPushNotificationConfigs',
  DELETE_PUSH_CONFIG: 'DeleteTaskPushNotificationConfig',
  GET_EXTENDED_AGENT_CARD: 'GetExtendedAgentCard',
} as const;

export type WebSocketMethod = (typeof WEBSOCKET_METHOD)[keyof typeof WEBSOCKET_METHOD];
export type WebSocketRequestId = string | number;
export type WebSocketServiceParameters = Record<string, string>;

/** `ws/Authenticate` credentials, keyed by Agent Card `securitySchemes` name. */
export type WebSocketCredentials = Record<string, string>;

/** A request (with `id`) or a notification (without `id`). */
export interface WebSocketRequestEnvelope {
  jsonrpc: typeof WEBSOCKET_JSONRPC_VERSION;
  id?: WebSocketRequestId;
  method: string;
  params?: unknown;
  serviceParams?: WebSocketServiceParameters;
}

/** A response (with `id`) or a server notification (with `method`). */
export interface WebSocketResponseEnvelope<T = unknown> {
  jsonrpc: typeof WEBSOCKET_JSONRPC_VERSION;
  id?: WebSocketRequestId | null;
  result?: T;
  error?: JSONRPCError;
  method?: string;
  params?: unknown;
}

/** `params` of `ws/StreamEnd` and `ws/CancelStream`. */
export interface WebSocketStreamControlParams {
  id: WebSocketRequestId;
}

/** `params` of `ws/ReauthenticationRequired`. */
export interface WebSocketReauthenticationRequiredParams {
  /** ProtoJSON timestamp after which the current credentials are rejected. */
  expiresAt: string;
}

export type WebSocketErrorResponse = JSONRPCErrorResponse & {
  jsonrpc: typeof WEBSOCKET_JSONRPC_VERSION;
};

export function isWebSocketRequestId(value: unknown): value is WebSocketRequestId {
  return (
    (typeof value === 'string' && value.length > 0) ||
    (typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value))
  );
}

export function requestIdKey(id: WebSocketRequestId): string {
  return `${typeof id === 'string' ? 's' : 'n'}:${String(id)}`;
}

export function isStreamingWebSocketMethod(method: string): boolean {
  return (
    method === WEBSOCKET_METHOD.SEND_STREAMING_MESSAGE ||
    method === WEBSOCKET_METHOD.SUBSCRIBE_TO_TASK
  );
}

/** Whether `method` is one of the A2A operations carried by the binding. */
export function isKnownWebSocketMethod(method: string): boolean {
  return Object.values(WEBSOCKET_METHOD).includes(method as WebSocketMethod);
}

/** Whether `method` uses the prefix reserved for control messages. */
export function isWebSocketControlMethod(method: string): boolean {
  return method.startsWith(WEBSOCKET_CONTROL_PREFIX);
}

/** Builds a `-32000` binding error carrying an `ErrorInfo` with `reason`. */
export function webSocketBindingError(
  reason: WebSocketBindingErrorReason,
  message: string,
  metadata?: Record<string, string>
): JSONRPCError {
  const info: A2AErrorInfo = {
    '@type': ERROR_INFO_TYPE,
    reason,
    domain: A2A_ERROR_DOMAIN,
    ...(metadata ? { metadata } : {}),
  };
  return { code: WEBSOCKET_SERVER_ERROR_CODE, message, data: [info] };
}

/**
 * Returns the binding-specific `reason` of an error, or `undefined` if it is
 * not a binding error. Accepts a JSON-RPC error object or an SDK error that
 * carries one in `data`.
 */
export function webSocketBindingErrorReason(
  error: unknown
): WebSocketBindingErrorReason | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { data } = error as { data?: unknown };
  if (!Array.isArray(data)) return undefined;
  const reasons = Object.values(WEBSOCKET_BINDING_ERROR) as string[];
  for (const detail of data as Array<Record<string, unknown>>) {
    if (
      detail?.['@type'] === ERROR_INFO_TYPE &&
      detail.domain === A2A_ERROR_DOMAIN &&
      typeof detail.reason === 'string' &&
      reasons.includes(detail.reason)
    ) {
      return detail.reason as WebSocketBindingErrorReason;
    }
  }
  return undefined;
}

export function normalizeServiceParameters(
  parameters: WebSocketServiceParameters | undefined
): WebSocketServiceParameters {
  const normalized: WebSocketServiceParameters = {};
  for (const [key, value] of Object.entries(parameters ?? {})) {
    normalized[key.toLowerCase()] = String(value);
  }
  return normalized;
}

/** Returns a key that appears more than once when compared case-insensitively. */
export function findDuplicateServiceParameter(
  parameters: WebSocketServiceParameters | undefined
): string | undefined {
  const seen = new Set<string>();
  for (const key of Object.keys(parameters ?? {})) {
    const lower = key.toLowerCase();
    if (seen.has(lower)) return key;
    seen.add(lower);
  }
  return undefined;
}

export function mergeServiceParameters(
  connectionParameters: WebSocketServiceParameters,
  requestParameters: WebSocketServiceParameters | undefined
): WebSocketServiceParameters {
  return {
    ...connectionParameters,
    ...normalizeServiceParameters(requestParameters),
  };
}

/**
 * Connection-scoped service parameters carried as `A2A-` query parameters,
 * which clients that cannot set handshake headers use. Keys are lowercased;
 * other query parameters are not service parameters.
 */
export function serviceParametersFromQuery(url: string | undefined): WebSocketServiceParameters {
  const parameters: WebSocketServiceParameters = {};
  if (!url) return parameters;
  let search: URLSearchParams;
  try {
    search = new URL(url, 'ws://localhost').searchParams;
  } catch {
    return parameters;
  }
  for (const [key, value] of search) {
    const lower = key.toLowerCase();
    if (lower.startsWith('a2a-') && !(lower in parameters)) parameters[lower] = value;
  }
  return parameters;
}

/** Adds `A2A-` service parameters to an endpoint URL as query parameters. */
export function withServiceParametersInQuery(
  endpoint: string,
  parameters: WebSocketServiceParameters
): string {
  const entries = Object.entries(parameters);
  if (entries.length === 0) return endpoint;
  const url = new URL(endpoint);
  for (const [key, value] of entries) url.searchParams.set(key, value);
  return url.toString();
}

export function isBinaryWebSocketData(data: unknown): boolean {
  return typeof data !== 'string';
}

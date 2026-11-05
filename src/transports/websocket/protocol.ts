import type { JSONRPCError, JSONRPCErrorResponse } from '../../core.js';

/** The Agent Card protocolBinding value defined by the WebSocket binding. */
export const WEBSOCKET_PROTOCOL_NAME = 'WEBSOCKET' as const;

/** The RFC 6455 sub-protocol negotiated by A2A WebSocket peers. */
export const WEBSOCKET_SUBPROTOCOL = 'a2a.v1' as const;

export const WEBSOCKET_JSONRPC_VERSION = '2.0' as const;
export const DEFAULT_WEBSOCKET_MAX_MESSAGE_BYTES = 1 << 20;

export const WEBSOCKET_CLOSE_CODE = {
  NORMAL_CLOSURE: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  INTERNAL_ERROR: 1011,
  TRY_AGAIN_LATER: 1013,
  A2A_PROTOCOL_ERROR: 4000,
  AUTHENTICATION_REQUIRED: 4001,
  VERSION_NOT_SUPPORTED: 4002,
} as const;

export const WEBSOCKET_SERVER_ERROR_CODE = -32000;
export const REAUTHENTICATION_REQUIRED_CONTROL = 'ReauthenticationRequired';

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
  AUTHENTICATE: 'Authenticate',
} as const;

export type WebSocketMethod = (typeof WEBSOCKET_METHOD)[keyof typeof WEBSOCKET_METHOD];
export type WebSocketRequestId = string | number;
export type WebSocketServiceParameters = Record<string, string>;

export interface WebSocketRequestEnvelope {
  jsonrpc: typeof WEBSOCKET_JSONRPC_VERSION;
  id: WebSocketRequestId;
  method?: string;
  params?: unknown;
  serviceParams?: WebSocketServiceParameters;
  cancelStream?: true;
}

export interface WebSocketResponseEnvelope<T = unknown> {
  jsonrpc: typeof WEBSOCKET_JSONRPC_VERSION;
  id?: WebSocketRequestId | null;
  result?: T;
  error?: JSONRPCError;
  streamEnd?: true;
  control?: string;
  reason?: string;
  retryAfterMs?: number;
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

export function isKnownWebSocketMethod(method: string): boolean {
  return Object.values(WEBSOCKET_METHOD).includes(method as WebSocketMethod);
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

export function mergeServiceParameters(
  connectionParameters: WebSocketServiceParameters,
  requestParameters: WebSocketServiceParameters | undefined
): WebSocketServiceParameters {
  return {
    ...connectionParameters,
    ...normalizeServiceParameters(requestParameters),
  };
}

export function isBinaryWebSocketData(data: unknown): boolean {
  return typeof data !== 'string';
}

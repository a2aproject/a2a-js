/**
 * Compat-layer constants and method-name mappings for the legacy A2A v0.3
 * protocol.
 */

import { A2AError } from './server/error.js';

/**
 * The legacy A2A protocol version this compat layer targets. Re-exported
 * from core so it's reachable via the compat import path.
 */
export { A2A_LEGACY_PROTOCOL_VERSION } from '../../constants.js';

/**
 * The HTTP extensions header used by v0.3. v1.0 dropped the `X-` prefix
 * (see `HTTP_EXTENSION_HEADER` in `src/constants.ts`).
 */
export const LEGACY_HTTP_EXTENSION_HEADER = 'X-A2A-Extensions';

/**
 * The content type used by v0.3 JSON-RPC and REST transports. v1.0 uses
 * `application/a2a+json` for REST/push payloads instead.
 */
export const LEGACY_JSON_CONTENT_TYPE = 'application/json';

export const LEGACY_METHOD_MESSAGE_SEND = 'message/send';
export const LEGACY_METHOD_MESSAGE_STREAM = 'message/stream';
export const LEGACY_METHOD_TASKS_GET = 'tasks/get';
export const LEGACY_METHOD_TASKS_CANCEL = 'tasks/cancel';
export const LEGACY_METHOD_TASKS_RESUBSCRIBE = 'tasks/resubscribe';
export const LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET = 'tasks/pushNotificationConfig/set';
export const LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET = 'tasks/pushNotificationConfig/get';
export const LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST = 'tasks/pushNotificationConfig/list';
export const LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE = 'tasks/pushNotificationConfig/delete';
export const LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD = 'agent/getAuthenticatedExtendedCard';

/** v0.3 JSON-RPC method string -> v1.0 PascalCase method name. */
export const LEGACY_JSONRPC_TO_V1: Readonly<Record<string, string>> = Object.freeze({
  [LEGACY_METHOD_MESSAGE_SEND]: 'SendMessage',
  [LEGACY_METHOD_MESSAGE_STREAM]: 'SendStreamingMessage',
  [LEGACY_METHOD_TASKS_GET]: 'GetTask',
  [LEGACY_METHOD_TASKS_CANCEL]: 'CancelTask',
  [LEGACY_METHOD_TASKS_RESUBSCRIBE]: 'SubscribeToTask',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET]: 'CreateTaskPushNotificationConfig',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET]: 'GetTaskPushNotificationConfig',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST]: 'ListTaskPushNotificationConfigs',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE]: 'DeleteTaskPushNotificationConfig',
  [LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD]: 'GetExtendedAgentCard',
});

/**
 * v1.0 method names with no equivalent in v0.3 (neither JSON-RPC nor
 * gRPC). Translating one of these names into the v0.3 coordinate system
 * yields `A2AError.unsupportedOperation` (-32004) instead of the generic
 * invalid-request error.
 *
 * `ListTasks` was gRPC/REST-only in v0.3 and the v0.3 protobuf shipped
 * here has no `ListTasks` RPC, so for compat purposes the v1.0
 * `ListTasks` is treated as fully absent.
 */
export const V1_METHODS_WITHOUT_LEGACY_EQUIVALENT: ReadonlySet<string> = new Set(['ListTasks']);

/**
 * v1.0 PascalCase method name -> v0.3 JSON-RPC method string.
 *
 * Methods listed in {@link V1_METHODS_WITHOUT_LEGACY_EQUIVALENT} are omitted.
 */
export const V1_TO_LEGACY_JSONRPC: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(LEGACY_JSONRPC_TO_V1).map(([k, v]) => [v, k]))
);

/** v0.3 JSON-RPC method string -> v0.3 gRPC PascalCase method name. */
export const LEGACY_JSONRPC_TO_LEGACY_GRPC: Readonly<Record<string, string>> = Object.freeze({
  [LEGACY_METHOD_MESSAGE_SEND]: 'SendMessage',
  [LEGACY_METHOD_MESSAGE_STREAM]: 'SendStreamingMessage',
  [LEGACY_METHOD_TASKS_GET]: 'GetTask',
  [LEGACY_METHOD_TASKS_CANCEL]: 'CancelTask',
  [LEGACY_METHOD_TASKS_RESUBSCRIBE]: 'TaskSubscription',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET]: 'CreateTaskPushNotificationConfig',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET]: 'GetTaskPushNotificationConfig',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST]: 'ListTaskPushNotificationConfig',
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE]: 'DeleteTaskPushNotificationConfig',
  [LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD]: 'GetAgentCard',
});

/** v0.3 gRPC PascalCase method name -> v0.3 JSON-RPC method string. */
export const LEGACY_GRPC_TO_LEGACY_JSONRPC: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(LEGACY_JSONRPC_TO_LEGACY_GRPC).map(([k, v]) => [v, k]))
);

/** v0.3 gRPC PascalCase method name -> v1.0 PascalCase method name. */
export const LEGACY_GRPC_TO_V1: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(LEGACY_JSONRPC_TO_LEGACY_GRPC).map(([jsonRpc, grpc]) => [
      grpc,
      LEGACY_JSONRPC_TO_V1[jsonRpc],
    ])
  )
);

/**
 * v1.0 PascalCase method name -> v0.3 gRPC PascalCase method name.
 *
 * Methods listed in {@link V1_METHODS_WITHOUT_LEGACY_EQUIVALENT} are omitted.
 */
export const V1_TO_LEGACY_GRPC: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(LEGACY_GRPC_TO_V1).map(([k, v]) => [v, k]))
);

const lookup = (
  table: Readonly<Record<string, string>>,
  method: string,
  direction: string
): string => {
  const mapped = table[method];
  if (mapped === undefined) {
    throw A2AError.invalidRequest(`Unknown ${direction} method: "${method}"`);
  }
  return mapped;
};

/**
 * Like `lookup`, but distinguishes "real v1.0 method without a v0.3
 * equivalent" (throws `A2AError.unsupportedOperation`) from "unknown
 * v1.0 method" (throws `A2AError.invalidRequest`).
 */
const lookupFromV1 = (
  table: Readonly<Record<string, string>>,
  method: string,
  legacyTransport: string
): string => {
  const mapped = table[method];
  if (mapped !== undefined) return mapped;
  if (V1_METHODS_WITHOUT_LEGACY_EQUIVALENT.has(method)) {
    throw A2AError.unsupportedOperation(
      `v1.0 method "${method}" has no equivalent in v0.3 ${legacyTransport}`
    );
  }
  throw A2AError.invalidRequest(`Unknown v1.0 method: "${method}"`);
};

/** Translate a v0.3 JSON-RPC method name to its v1.0 PascalCase equivalent. */
export function legacyJsonRpcToV1Method(method: string): string {
  return lookup(LEGACY_JSONRPC_TO_V1, method, 'legacy JSON-RPC');
}

/**
 * Returns `true` if `method` is a known v0.3 JSON-RPC method name. Used
 * by the Express JSON-RPC handler to route between the v1.0 and v0.3
 * dispatchers.
 */
export function isLegacyJsonRpcMethod(method: unknown): boolean {
  return typeof method === 'string' && method in LEGACY_JSONRPC_TO_V1;
}

/**
 * Translate a v1.0 method name to its v0.3 JSON-RPC equivalent. Throws
 * `A2AError.unsupportedOperation` for v1.0 names with no v0.3 equivalent
 * (e.g. `ListTasks`); throws `A2AError.invalidRequest` for unknown names.
 */
export function v1MethodToLegacyJsonRpc(method: string): string {
  return lookupFromV1(V1_TO_LEGACY_JSONRPC, method, 'JSON-RPC');
}

/** Translate a v0.3 JSON-RPC method name to its v0.3 gRPC equivalent. */
export function legacyJsonRpcToLegacyGrpcMethod(method: string): string {
  return lookup(LEGACY_JSONRPC_TO_LEGACY_GRPC, method, 'legacy JSON-RPC');
}

/** Translate a v0.3 gRPC method name to its v0.3 JSON-RPC equivalent. */
export function legacyGrpcToLegacyJsonRpcMethod(method: string): string {
  return lookup(LEGACY_GRPC_TO_LEGACY_JSONRPC, method, 'legacy gRPC');
}

/** Translate a v0.3 gRPC method name to its v1.0 PascalCase equivalent. */
export function legacyGrpcToV1Method(method: string): string {
  return lookup(LEGACY_GRPC_TO_V1, method, 'legacy gRPC');
}

/**
 * Translate a v1.0 method name to its v0.3 gRPC equivalent. Throws
 * `A2AError.unsupportedOperation` for v1.0 names with no v0.3 equivalent
 * (e.g. `ListTasks`); throws `A2AError.invalidRequest` for unknown names.
 */
export function v1MethodToLegacyGrpc(method: string): string {
  return lookupFromV1(V1_TO_LEGACY_GRPC, method, 'gRPC');
}

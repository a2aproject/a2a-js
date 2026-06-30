/**
 * Public entry point for the A2A v0.3 backward-compatibility layer.
 * Exposes only pure-data and pure-function symbols (legacy protocol
 * constants and method-name translators) so this entry point is
 * Workers-safe.
 *
 * Runtime-specific bits live under their own subpaths so each subpath
 * carries only the peer dependencies (`express`, `@grpc/grpc-js`) its
 * runtime needs. See `src/compat/v0_3/README.md` for the layout.
 */

export {
  A2A_LEGACY_PROTOCOL_VERSION,
  LEGACY_HTTP_EXTENSION_HEADER,
  LEGACY_JSON_CONTENT_TYPE,
  LEGACY_METHOD_MESSAGE_SEND,
  LEGACY_METHOD_MESSAGE_STREAM,
  LEGACY_METHOD_TASKS_GET,
  LEGACY_METHOD_TASKS_CANCEL,
  LEGACY_METHOD_TASKS_RESUBSCRIBE,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE,
  LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD,
  isLegacyJsonRpcMethod,
  isV1JsonRpcMethod,
  legacyJsonRpcToV1Method,
  v1MethodToLegacyJsonRpc,
  legacyJsonRpcToLegacyGrpcMethod,
  legacyGrpcToLegacyJsonRpcMethod,
  legacyGrpcToV1Method,
  v1MethodToLegacyGrpc,
} from './constants.js';

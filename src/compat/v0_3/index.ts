/**
 * Public entry point for the A2A v0.3 backward-compatibility layer.
 *
 * This barrel intentionally exposes ONLY the legacy protocol constants
 * and the method-name translation helpers. They are pure-data /
 * pure-function symbols with no Node-only or framework-only dependencies,
 * so this entry point is safe to import from Cloudflare Workers / edge
 * runtimes alongside the v1.0 `JsonRpcTransportFactory` and
 * `RestTransportFactory`.
 *
 * The server-side handlers and client-side transports live under their
 * own subpaths so that each subpath carries only the peer dependencies
 * (`express`, `@grpc/grpc-js`) its runtime needs. The layout mirrors
 * the v1.0 surface: `server` is framework-agnostic, `server/express`
 * and `server/grpc` carry the runtime-specific bits.
 *
 *   - `@a2a-js/sdk/compat/v0_3/server`         — Framework-agnostic
 *                                                 JSON-RPC + REST transport
 *                                                 handlers + push-notification
 *                                                 factory and serializer
 *                                                 (Workers-safe)
 *   - `@a2a-js/sdk/compat/v0_3/server/express` — Express routers
 *                                                 (`legacyAgentCardRouter`,
 *                                                 `legacyRestRouter`)
 *                                                 (requires `express`)
 *   - `@a2a-js/sdk/compat/v0_3/server/grpc`    — v0.3 gRPC service factory
 *                                                 (requires `@grpc/grpc-js`)
 *   - `@a2a-js/sdk/compat/v0_3/client`         — v0.3 JSON-RPC + REST
 *                                                 client transports + agent
 *                                                 card parsing helpers
 *                                                 (Workers-safe)
 *   - `@a2a-js/sdk/compat/v0_3/client/grpc`    — v0.3 gRPC client transport
 *                                                 (requires `@grpc/grpc-js`)
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
  legacyJsonRpcToV1Method,
  v1MethodToLegacyJsonRpc,
  legacyJsonRpcToLegacyGrpcMethod,
  legacyGrpcToLegacyJsonRpcMethod,
  legacyGrpcToV1Method,
  v1MethodToLegacyGrpc,
} from './constants.js';

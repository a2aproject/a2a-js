/**
 * Framework-agnostic entry point for the v0.3 backward-compat server
 * surface.
 *
 * The Express router-style integration (`legacyAgentCardRouter`,
 * `legacyRestRouter`) lives at `@a2a-js/sdk/compat/v0_3/server/express`.
 * The v0.3 gRPC service factory (`legacyGrpcService`, `LegacyA2AService`)
 * lives at `@a2a-js/sdk/compat/v0_3/server/grpc`.
 */

export { LegacyJsonRpcTransportHandler } from './transports/jsonrpc/jsonrpc_transport_handler.js';
export {
  LegacyRestTransportHandler,
  toLegacyHTTPError,
  type LegacyRestErrorBody,
} from './transports/rest/rest_transport_handler.js';
export {
  createLegacyAwarePushNotificationSender,
  V03PushNotificationSerializer,
} from './push_notification/index.js';
export { A2AError as LegacyA2AError } from './error.js';

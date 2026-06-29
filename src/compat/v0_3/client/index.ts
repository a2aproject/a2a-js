/**
 * v0.3 client transports. The gRPC client lives in
 * `@a2a-js/sdk/compat/v0_3/client/grpc` (Node-only); the JSON-RPC and
 * REST transports here stay Workers-safe.
 */

export { isLegacyAgentCard, parseLegacyAgentCard } from './card-resolver.js';
export {
  LegacyJsonRpcTransport,
  type LegacyJsonRpcTransportOptions,
} from './transports/json_rpc_transport.js';

export {
  LegacyRestTransport,
  type LegacyRestTransportOptions,
} from './transports/rest_transport.js';

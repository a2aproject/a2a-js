/**
 * Compat-layer client components for v0.3 transports.
 *
 * The v0.3 gRPC client (`LegacyGrpcTransport`) is intentionally NOT
 * re-exported from this barrel: it transitively imports
 * `@grpc/grpc-js`, which has Node-only dependencies (`node:process`, the
 * native I/O bindings) and is incompatible with the Cloudflare Workers
 * runtime that the v1.0 `JsonRpcTransportFactory` and
 * `RestTransportFactory` must support. Consumers that need the gRPC
 * compat client should import it from
 * `@a2a-js/sdk/compat/v0_3/client/grpc` (i.e. through the v1.0
 * `GrpcTransportFactory.legacyCompat` opt-in path, mirroring how
 * `@a2a-js/sdk/client/grpc` is the only Node-required client-side
 * entry point).
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

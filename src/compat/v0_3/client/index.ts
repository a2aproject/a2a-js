/**
 * Compat-layer client components for v0.3 transports.
 */

export { isLegacyAgentCard, parseLegacyAgentCard } from './card-resolver.js';
export {
  LegacyJsonRpcTransport,
  type LegacyJsonRpcTransportOptions,
} from './transports/json_rpc_transport.js';

/**
 * Compat-layer client components for v0.3 transports.
 */

export {
  LegacyJsonRpcTransport,
  type LegacyJsonRpcTransportOptions,
} from './transports/json_rpc_transport.js';

export {
  LegacyRestTransport,
  type LegacyRestTransportOptions,
} from './transports/rest_transport.js';

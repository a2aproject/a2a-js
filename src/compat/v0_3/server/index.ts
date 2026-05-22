/**
 * Compat-layer server components for v0.3 handlers.
 */

export { A2AError as LegacyA2AError } from './error.js';
export { LegacyJsonRpcTransportHandler } from './transports/jsonrpc/jsonrpc_transport_handler.js';
export {
  LegacyRestTransportHandler,
  toLegacyHTTPError,
  type LegacyRestErrorBody,
} from './transports/rest/rest_transport_handler.js';
export { legacyRestRouter, type LegacyRestHandlerOptions } from './express/rest_handler.js';

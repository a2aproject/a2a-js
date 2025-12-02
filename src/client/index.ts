/**
 * Client entry point for the A2A Server V2 library.
 */

export { A2AClient } from './client.js';
export type { A2AClientOptions } from './client.js';
export * from './auth-handler.js';
export { Client, ClientConfig, RequestOptions } from './multitransport-client.js';
export { Transport, TransportFactory } from './transports/transport.js';
export { ClientFactory, ClientFactoryOptions } from './factory.js';
export {
  JsonRpcTransport,
  JsonRpcTransportFactory,
  JsonRpcTransportOptions,
} from './transports/json_rpc_transport.js';
export {
  CallInterceptor,
  BeforeArgs,
  AfterArgs,
  ClientCallInput,
  ClientCallResult,
} from './interceptors.js';

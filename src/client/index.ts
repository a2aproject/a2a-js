/**
 * Client entry point for the A2A Server V2 library.
 */

export { A2AClient } from './client.js';
export type { A2AClientOptions } from './client.js';
export * from './auth-handler.js';
export {
  AgentCardResolver,
  type AgentCardResolverOptions,
  DefaultAgentCardResolver,
} from './card-resolver.js';
export { Client, type ClientConfig, type RequestOptions } from './multitransport-client.js';
export type { Transport, TransportFactory } from './transports/transport.js';
export { ClientFactory, ClientFactoryOptions } from './factory.js';
export {
  JsonRpcTransport,
  JsonRpcTransportFactory,
  type JsonRpcTransportOptions,
} from './transports/json_rpc_transport.js';
export {
  RestTransport,
  RestTransportFactory,
  type RestTransportOptions,
} from './transports/rest_transport.js';
export type {
  CallInterceptor,
  BeforeArgs,
  AfterArgs,
  ClientCallInput,
  ClientCallResult,
} from './interceptors.js';
export {
  ServiceParameters,
  type ServiceParametersUpdate,
  withA2AExtensions,
} from './service-parameters.js';
export { ClientCallContext, type ContextUpdate, ClientCallContextKey } from './context.js';

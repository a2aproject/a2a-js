/** Client entry point for the A2A SDK. */

export * from './auth-handler.js';
export {
  AgentCardResolver,
  type AgentCardResolverOptions,
  DefaultAgentCardResolver,
} from './card-resolver.js';
export { Client, type ClientConfig, type RequestOptions } from './multitransport-client.js';
export type { Transport, TransportFactory } from './transports/transport.js';
export { TenantTransportDecorator } from './transports/tenant_transport_decorator.js';
export { ClientFactory, ClientFactoryOptions } from './factory.js';
export { JsonRpcTransportFactory } from './transports/json_rpc_transport.js';
export { RestTransportFactory } from './transports/rest_transport.js';
export {
  WebSocketTransport,
  WebSocketTransportFactory,
  type A2AWebSocket,
  type WebSocketCredential,
  type WebSocketFactory,
  type WebSocketFactoryOptions,
  type WebSocketReauthenticationRequired,
  type WebSocketTransportOptions,
} from './transports/websocket.js';
export {
  DEFAULT_WEBSOCKET_MAX_MESSAGE_BYTES,
  REAUTHENTICATION_REQUIRED_CONTROL,
  WEBSOCKET_CLOSE_CODE,
  WEBSOCKET_JSONRPC_VERSION,
  WEBSOCKET_METHOD,
  WEBSOCKET_PROTOCOL_NAME,
  WEBSOCKET_SUBPROTOCOL,
  type WebSocketRequestEnvelope,
  type WebSocketRequestId,
  type WebSocketResponseEnvelope,
  type WebSocketServiceParameters,
} from '../transports/websocket/protocol.js';
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
  withA2AVersion,
} from './service-parameters.js';
export { ClientCallContext, type ContextUpdate, ClientCallContextKey } from './context.js';

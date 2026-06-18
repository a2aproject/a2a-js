/**
 * v0.3 gRPC client integration for the A2A Client (compat layer).
 *
 * Exports the `LegacyGrpcTransport` class that the v1.0
 * `GrpcTransportFactory` instantiates when `legacyCompat: { enabled: true }`
 * is set and the matched `AgentInterface.protocolVersion` falls in
 * `[0.3, 1.0)`.
 */

export { LegacyGrpcTransport, type LegacyGrpcTransportOptions } from './grpc_transport.js';

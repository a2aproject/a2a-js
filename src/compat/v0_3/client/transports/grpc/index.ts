// v0.3 gRPC client. Lazy-loaded by the v1.0 `GrpcTransportFactory` when
// `legacyCompat: { enabled: true }` matches a legacy interface.

export { LegacyGrpcTransport, type LegacyGrpcTransportOptions } from './grpc_transport.js';

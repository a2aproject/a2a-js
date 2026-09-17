/**
 * v0.3 gRPC integration for the A2A server. Exports `legacyGrpcService`
 * and `LegacyA2AService` so the v0.3 surface can be registered alongside
 * the v1.0 service on the same gRPC `Server`.
 */

export { legacyGrpcService, type LegacyGrpcServiceOptions } from './grpc_service.js';
export { A2AServiceService as LegacyA2AService } from '../../grpc/pb/a2a.js';

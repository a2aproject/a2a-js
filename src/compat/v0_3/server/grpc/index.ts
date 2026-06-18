/**
 * v0.3 gRPC integration for the A2A Server (compat layer).
 *
 * This module exports the v0.3 `A2AServiceServer` factory
 * (`legacyGrpcService`) and the v0.3 service descriptor
 * (`LegacyA2AService`) so operators can register the v0.3 surface
 * side-by-side with the v1.0 service on a single gRPC `Server`.
 */

export { legacyGrpcService, type LegacyGrpcServiceOptions } from './grpc_service.js';
export { A2AServiceService as LegacyA2AService } from '../../grpc/pb/a2a.js';

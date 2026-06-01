/**
 * gRPC integration for the A2A Server library.
 * This module provides gRPC specific functionality for both the v1.0
 * service and (via the compat re-exports) the v0.3 service so operators
 * can register both on the same gRPC `Server`.
 */

export { grpcService } from './grpc_service.js';
export type { GrpcServiceOptions } from './grpc_service.js';
export { A2AServiceService as A2AService } from '../../grpc/pb/a2a.js';
export { UserBuilder } from './common.js';

// v0.3 compat re-exports. Surfaced here so operators only need a single
// import path (`@a2a-js/sdk/server/grpc`) to mount both versions side by
// side; see `legacyGrpcService` for the registration pattern.
export {
  legacyGrpcService,
  LegacyA2AService,
  type LegacyGrpcServiceOptions,
} from '../../compat/v0_3/server/grpc/index.js';

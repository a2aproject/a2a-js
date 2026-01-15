/**
 * gRPC integration for the A2A Server library.
 * This module provides gRPC specific functionality.
 */

export { grpcService } from './grpc_service.js';
export type { GrpcServiceOptions } from './grpc_service.js';
export { A2AServiceService as A2AService } from '../../grpc/pb/a2a_services.js';
export { UserBuilder } from './common.js';

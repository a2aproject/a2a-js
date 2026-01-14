/**
 * gRPC integration for the A2A Server library.
 * This module provides gRPC specific functionality.
 */

export { grpcHandler } from './grpc_handler.js';
export type { GrpcHandlerOptions as grpcHandlerOptions } from './grpc_handler.js';
export { A2AServiceService as A2AService } from '../../grpc/a2a_services.js';
export { UserBuilder } from './common.js';

/** gRPC integration for the A2A v1.0 service. */

export { grpcService } from './grpc_service.js';
export type { GrpcServiceOptions } from './grpc_service.js';
export { A2AServiceService as A2AService } from '../../grpc/pb/a2a.js';
export { UserBuilder } from './common.js';

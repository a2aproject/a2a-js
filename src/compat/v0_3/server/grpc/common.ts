// Re-exports the v1.0 `UserBuilder` so the same auth function plugs into
// both `grpcService` (v1.0) and `legacyGrpcService` (v0.3).

export { UserBuilder } from '../../../../server/grpc/common.js';

/**
 * Shared gRPC helpers for the v0.3 compat server.
 *
 * Re-exports the v1.0 {@link UserBuilder} contract verbatim so operators
 * can plug the same authentication function into both `grpcService` (v1.0)
 * and `legacyGrpcService` (v0.3) without juggling two interfaces.
 */

export { UserBuilder } from '../../../../server/grpc/common.js';

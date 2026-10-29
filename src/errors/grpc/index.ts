/**
 * Public entrypoint for the gRPC-specific A2A error hierarchy.
 * Explicit named re-exports so this file defines the API contract of
 * `@a2a-js/sdk/errors/grpc`. Internal registries stay in `./grpc.ts`.
 */

export {
  buildGrpcErrorMetadata,
  type DecodedErrorInfo,
  type DecodedStatus,
  decodeErrorInfo,
  decodeStatus,
  encodeGrpcStatusDetails,
  fromGrpcError,
  type GrpcA2AError,
  type GrpcA2AErrorOptions,
  GrpcContentTypeNotSupportedError,
  GrpcExtendedAgentCardNotConfiguredError,
  GrpcExtensionSupportRequiredError,
  GrpcInvalidAgentResponseError,
  GrpcPushNotificationNotSupportedError,
  GrpcRequestMalformedError,
  grpcStatusFor,
  GrpcTaskNotCancelableError,
  GrpcTaskNotFoundError,
  GrpcUnsupportedOperationError,
  GrpcVersionNotSupportedError,
  GRPC_STATUS_CODE,
  GRPC_STATUS_DETAILS_BIN,
  isGrpcError,
} from './grpc.js';

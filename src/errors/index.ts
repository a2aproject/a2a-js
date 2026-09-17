/**
 * Public entrypoint for the transport-agnostic A2A error hierarchy.
 * Contract of `@a2a-js/sdk/errors`: semantic error classes, transport
 * variants, type guards, wire helpers, and the constants a caller
 * needs to construct or interpret them. Internal registries (spec
 * tables, class maps) stay in `./base.ts` / `./rest.ts` / `./json_rpc.ts`
 * and are consumed only inside `src/`.
 *
 * gRPC errors live at `@a2a-js/sdk/errors/grpc` because their
 * encode/decode helpers pull `@bufbuild/protobuf`.
 */

// --- base ---
export {
  A2A_ERROR_DOMAIN,
  A2AError,
  type A2AErrorInfo,
  type A2AErrorOptions,
  ContentTypeNotSupportedError,
  ERROR_INFO_TYPE,
  type ErrorDetail,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  extractErrorMessage,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
} from './base.js';

// --- REST transport ---
export {
  fromRestErrorBody,
  HTTP_STATUS,
  isRestError,
  type RestA2AError,
  type RestA2AErrorOptions,
  RestContentTypeNotSupportedError,
  type RestErrorBody,
  RestExtendedAgentCardNotConfiguredError,
  RestExtensionSupportRequiredError,
  RestInvalidAgentResponseError,
  RestPushNotificationNotSupportedError,
  RestRequestMalformedError,
  restStatusFor,
  RestTaskNotCancelableError,
  RestTaskNotFoundError,
  RestUnsupportedOperationError,
  RestVersionNotSupportedError,
  toRestErrorBody,
} from './rest.js';

// --- JSON-RPC transport ---
export {
  A2A_ERROR_CODE,
  fromJsonRpcErrorResponse,
  isJsonRpcError,
  type JsonRpcA2AError,
  type JsonRpcA2AErrorOptions,
  JsonRpcContentTypeNotSupportedError,
  JsonRpcExtendedAgentCardNotConfiguredError,
  JsonRpcExtensionSupportRequiredError,
  JsonRpcInvalidAgentResponseError,
  JsonRpcPushNotificationNotSupportedError,
  JsonRpcRequestMalformedError,
  JsonRpcTaskNotCancelableError,
  JsonRpcTaskNotFoundError,
  JsonRpcTransportError,
  JsonRpcUnsupportedOperationError,
  JsonRpcVersionNotSupportedError,
  toJsonRpcError,
} from './json_rpc.js';

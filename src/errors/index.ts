/**
 * Public entrypoint for the transport-agnostic A2A error hierarchy.
 * Explicit named re-exports so this file defines the API contract of
 * `@a2a-js/sdk/errors`; a `base.ts` helper added tomorrow does NOT
 * accidentally become public API.
 *
 * gRPC errors live at `@a2a-js/sdk/errors/grpc` because their
 * encode/decode helpers pull `@bufbuild/protobuf`.
 */

// --- base ---
export {
  A2A_ERROR_DOMAIN,
  A2A_ERROR_CLASSES,
  A2A_ERROR_SPECS,
  A2A_ERROR_SPECS_BY_REASON,
  A2AError,
  type A2AErrorClass,
  type A2AErrorInfo,
  type A2AErrorOptions,
  type A2AErrorSpec,
  ContentTypeNotSupportedError,
  ERROR_INFO_TYPE,
  type ErrorDetail,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  extractErrorMessage,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  specForError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
} from './base.js';

// --- REST transport ---
export {
  HTTP_STATUS,
  isRestError,
  REST_ERROR_CLASSES,
  REST_ERROR_HTTP_STATUS,
  REST_ERROR_STATUS_NAME,
  REST_STATUS_NAME,
  type RestA2AError,
  type RestA2AErrorOptions,
  type RestErrorBody,
  RestContentTypeNotSupportedError,
  RestExtendedAgentCardNotConfiguredError,
  RestExtensionSupportRequiredError,
  RestInvalidAgentResponseError,
  RestPushNotificationNotSupportedError,
  RestRequestMalformedError,
  RestTaskNotCancelableError,
  RestTaskNotFoundError,
  RestUnsupportedOperationError,
  RestVersionNotSupportedError,
  fromRestErrorBody,
  restStatusFor,
  toRestErrorBody,
} from './rest.js';

// --- JSON-RPC transport ---
export {
  A2A_ERROR_CODE,
  fromJsonRpcErrorResponse,
  isJsonRpcError,
  JSON_RPC_CODE_TO_ERROR,
  JSON_RPC_ERROR_CLASSES,
  JSON_RPC_ERROR_CODE,
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

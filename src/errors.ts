// Legacy JSON-RPC error codes.
export const A2A_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  EXTENDED_CARD_NOT_CONFIGURED: -32007,
  EXTENSION_SUPPORT_REQUIRED: -32008,
  VERSION_NOT_SUPPORTED: -32009,
} as const;

/**
 * The domain value for all A2A-specific errors.
 * Used in `google.rpc.ErrorInfo` details across all transport bindings (§9.5, §10.6, §11.6).
 */
export const A2A_ERROR_DOMAIN = 'a2a-protocol.org';

/**
 * The `@type` URL for `google.rpc.ErrorInfo` in ProtoJSON `Any` representation.
 */
export const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo';

/**
 * A structured detail object included in error responses.
 * Each object MUST include a `@type` key per §3.3.2.
 */
export interface ErrorDetail {
  '@type': string;
  [key: string]: unknown;
}

/**
 * The `google.rpc.ErrorInfo` structure used across all A2A transport bindings.
 * Included in `error.data` (JSON-RPC), `error.details` (REST), and
 * `status.details` (gRPC) per §9.5, §11.6, §10.6.
 */
export interface A2AErrorInfo extends ErrorDetail {
  '@type': typeof ERROR_INFO_TYPE;
  reason: string;
  domain: typeof A2A_ERROR_DOMAIN;
  metadata?: Record<string, string>;
}

/**
 * REST error response structure per §11.6 (google.rpc.Status JSON representation).
 */
export interface RestErrorBody {
  error: {
    code: number;
    status: string;
    message: string;
    details: ErrorDetail[];
  };
}

/**
 * Mapping of error class names to UPPER_SNAKE_CASE reason codes.
 * The reason is the error type name without the "Error" suffix, in UPPER_SNAKE_CASE.
 * Used in `google.rpc.ErrorInfo.reason` per §9.5, §10.6, §11.6.
 */
export const A2A_ERROR_REASON: Record<string, string> = {
  TaskNotFoundError: 'TASK_NOT_FOUND',
  TaskNotCancelableError: 'TASK_NOT_CANCELABLE',
  PushNotificationNotSupportedError: 'PUSH_NOTIFICATION_NOT_SUPPORTED',
  UnsupportedOperationError: 'UNSUPPORTED_OPERATION',
  ContentTypeNotSupportedError: 'CONTENT_TYPE_NOT_SUPPORTED',
  InvalidAgentResponseError: 'INVALID_AGENT_RESPONSE',
  ExtendedAgentCardNotConfiguredError: 'EXTENDED_AGENT_CARD_NOT_CONFIGURED',
  ExtensionSupportRequiredError: 'EXTENSION_SUPPORT_REQUIRED',
  VersionNotSupportedError: 'VERSION_NOT_SUPPORTED',
  RequestMalformedError: 'INVALID_PARAMS',
  GenericError: 'INTERNAL_ERROR',
};

/**
 * Reverse mapping from reason codes to error class names.
 * Used by client transports to reconstruct SDK error classes from ErrorInfo.
 */
export const A2A_REASON_TO_ERROR: Record<string, string> = Object.fromEntries(
  Object.entries(A2A_ERROR_REASON).map(([cls, reason]) => [reason, cls])
);

/**
 * Builds a `google.rpc.ErrorInfo` detail object from an error instance.
 *
 * @param error - The error to build ErrorInfo from.
 * @param metadata - Optional additional context metadata.
 * @returns An `A2AErrorInfo` object, or `undefined` if the error has no known reason.
 */
export function buildErrorInfo(
  error: Error,
  metadata?: Record<string, string>
): A2AErrorInfo | undefined {
  const reason = A2A_ERROR_REASON[error.name];
  if (!reason) return undefined;
  return {
    '@type': ERROR_INFO_TYPE,
    reason,
    domain: A2A_ERROR_DOMAIN,
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

/**
 * Per-error gRPC status name mapping per §5.4.
 * Used in REST error responses for the `error.status` field (§11.6).
 *
 * Multiple A2A errors may share the same HTTP status code (e.g., 400) but
 * have different gRPC statuses (FAILED_PRECONDITION vs INVALID_ARGUMENT).
 * This mapping ensures the correct gRPC status name is used for each error.
 */
export const A2A_ERROR_GRPC_STATUS: Record<string, string> = {
  TaskNotFoundError: 'NOT_FOUND',
  TaskNotCancelableError: 'FAILED_PRECONDITION',
  PushNotificationNotSupportedError: 'FAILED_PRECONDITION',
  UnsupportedOperationError: 'FAILED_PRECONDITION',
  ContentTypeNotSupportedError: 'INVALID_ARGUMENT',
  InvalidAgentResponseError: 'INTERNAL',
  ExtendedAgentCardNotConfiguredError: 'FAILED_PRECONDITION',
  ExtensionSupportRequiredError: 'FAILED_PRECONDITION',
  VersionNotSupportedError: 'FAILED_PRECONDITION',
  RequestMalformedError: 'INVALID_ARGUMENT',
  GenericError: 'INTERNAL',
};

/**
 * Returns the gRPC status name for an error instance.
 * Falls back to HTTP-status-based inference for unknown errors.
 */
export function getGrpcStatusName(error: unknown, httpStatus: number): string {
  if (error instanceof Error && A2A_ERROR_GRPC_STATUS[error.name]) {
    return A2A_ERROR_GRPC_STATUS[error.name];
  }
  // Fallback for unknown errors
  if (httpStatus === 404) return 'NOT_FOUND';
  if (httpStatus === 500) return 'INTERNAL';
  if (httpStatus === 400) return 'INVALID_ARGUMENT';
  return 'UNKNOWN';
}

// --------------------------------------------------
// These errors are a2a-js SDK specific and not covered by the protocol's documentation.
// They are used when the error does not fit into any of the other error categories.

export class RequestMalformedError extends Error {
  constructor(message?: string) {
    super(message ?? 'Request malformed');
    this.name = 'RequestMalformedError';
  }
}

export class GenericError extends Error {
  constructor(message?: string) {
    super(message ?? 'An unexpected error occurred.');
    this.name = 'GenericError';
  }
}

// End of a2a-js SDK specific errors.
// --------------------------------------------------

// Transport-agnostic errors per §3.3.2 A2A-Specific Error Types.

export class TaskNotFoundError extends Error {
  constructor(message?: string) {
    super(message ?? 'Task not found');
    this.name = 'TaskNotFoundError';
  }
}

export class TaskNotCancelableError extends Error {
  constructor(message?: string) {
    super(message ?? 'Task cannot be canceled');
    this.name = 'TaskNotCancelableError';
  }
}

export class PushNotificationNotSupportedError extends Error {
  constructor(message?: string) {
    super(message ?? 'Push Notification is not supported');
    this.name = 'PushNotificationNotSupportedError';
  }
}

export class UnsupportedOperationError extends Error {
  constructor(message?: string) {
    super(message ?? 'This operation is not supported');
    this.name = 'UnsupportedOperationError';
  }
}

export class ContentTypeNotSupportedError extends Error {
  constructor(message?: string) {
    super(message ?? 'Incompatible content types');
    this.name = 'ContentTypeNotSupportedError';
  }
}

export class InvalidAgentResponseError extends Error {
  constructor(message?: string) {
    super(message ?? 'Invalid agent response type');
    this.name = 'InvalidAgentResponseError';
  }
}

export class ExtendedAgentCardNotConfiguredError extends Error {
  constructor(message?: string) {
    super(message ?? 'Extended Agent Card not configured');
    this.name = 'ExtendedAgentCardNotConfiguredError';
  }
}

export class ExtensionSupportRequiredError extends Error {
  constructor(message?: string) {
    super(message ?? 'Extension support required');
    this.name = 'ExtensionSupportRequiredError';
  }
}

export class VersionNotSupportedError extends Error {
  constructor(message?: string) {
    super(message ?? 'Version not supported');
    this.name = 'VersionNotSupportedError';
  }
}

/**
 * Maps UPPER_SNAKE_CASE reason codes to error class constructors.
 * Used by client transports to reconstruct SDK error instances from
 * `google.rpc.ErrorInfo.reason` values received in error responses.
 */
export const A2A_REASON_TO_ERROR_CLASS: Record<string, new (message?: string) => Error> = {
  TASK_NOT_FOUND: TaskNotFoundError,
  TASK_NOT_CANCELABLE: TaskNotCancelableError,
  PUSH_NOTIFICATION_NOT_SUPPORTED: PushNotificationNotSupportedError,
  UNSUPPORTED_OPERATION: UnsupportedOperationError,
  CONTENT_TYPE_NOT_SUPPORTED: ContentTypeNotSupportedError,
  INVALID_AGENT_RESPONSE: InvalidAgentResponseError,
  EXTENDED_AGENT_CARD_NOT_CONFIGURED: ExtendedAgentCardNotConfiguredError,
  EXTENSION_SUPPORT_REQUIRED: ExtensionSupportRequiredError,
  VERSION_NOT_SUPPORTED: VersionNotSupportedError,
  INVALID_PARAMS: RequestMalformedError,
  INTERNAL_ERROR: GenericError,
};

/**
 * Maps error class names to error class constructors.
 * Used by client transports to reconstruct SDK error instances from
 * legacy error responses that include the error class name.
 */
export const A2A_NAME_TO_ERROR_CLASS: Record<string, new (message?: string) => Error> =
  Object.fromEntries(
    Object.entries(A2A_ERROR_REASON).map(([name, reason]) => [
      name,
      A2A_REASON_TO_ERROR_CLASS[reason],
    ])
  );

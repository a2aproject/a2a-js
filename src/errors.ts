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
  AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED: -32007,
} as const;

/**
 * Optional HTTP transport details that can be attached to any A2A error
 * originating from an HTTP response.
 */
export interface A2AErrorHttpDetails {
  /** The HTTP status code from the response (e.g. 401, 404, 429, 503). */
  statusCode?: number;
  /** Selected HTTP response headers, if available. */
  headers?: Record<string, string>;
}

// Transport-agnostic errors according to https://a2a-protocol.org/v0.3.0/specification/#82-a2a-specific-errors.
// Due to a name conflict with legacy JSON-RPC types reexported from src/index.ts
// below errors are going to be exported via src/client/index.ts to allow usage
// from external transport implementations.

export class TaskNotFoundError extends Error {
  /** The HTTP status code from the response, if the error originated from an HTTP transport. */
  statusCode?: number;
  /** Selected HTTP response headers, if the error originated from an HTTP transport. */
  headers?: Record<string, string>;

  constructor(message?: string, httpDetails?: A2AErrorHttpDetails) {
    super(message ?? 'Task not found');
    this.name = 'TaskNotFoundError';
    this.statusCode = httpDetails?.statusCode;
    this.headers = httpDetails?.headers;
  }
}

export class TaskNotCancelableError extends Error {
  /** The HTTP status code from the response, if the error originated from an HTTP transport. */
  statusCode?: number;
  /** Selected HTTP response headers, if the error originated from an HTTP transport. */
  headers?: Record<string, string>;

  constructor(message?: string, httpDetails?: A2AErrorHttpDetails) {
    super(message ?? 'Task cannot be canceled');
    this.name = 'TaskNotCancelableError';
    this.statusCode = httpDetails?.statusCode;
    this.headers = httpDetails?.headers;
  }
}

export class PushNotificationNotSupportedError extends Error {
  /** The HTTP status code from the response, if the error originated from an HTTP transport. */
  statusCode?: number;
  /** Selected HTTP response headers, if the error originated from an HTTP transport. */
  headers?: Record<string, string>;

  constructor(message?: string, httpDetails?: A2AErrorHttpDetails) {
    super(message ?? 'Push Notification is not supported');
    this.name = 'PushNotificationNotSupportedError';
    this.statusCode = httpDetails?.statusCode;
    this.headers = httpDetails?.headers;
  }
}

export class UnsupportedOperationError extends Error {
  /** The HTTP status code from the response, if the error originated from an HTTP transport. */
  statusCode?: number;
  /** Selected HTTP response headers, if the error originated from an HTTP transport. */
  headers?: Record<string, string>;

  constructor(message?: string, httpDetails?: A2AErrorHttpDetails) {
    super(message ?? 'This operation is not supported');
    this.name = 'UnsupportedOperationError';
    this.statusCode = httpDetails?.statusCode;
    this.headers = httpDetails?.headers;
  }
}

export class ContentTypeNotSupportedError extends Error {
  /** The HTTP status code from the response, if the error originated from an HTTP transport. */
  statusCode?: number;
  /** Selected HTTP response headers, if the error originated from an HTTP transport. */
  headers?: Record<string, string>;

  constructor(message?: string, httpDetails?: A2AErrorHttpDetails) {
    super(message ?? 'Incompatible content types');
    this.name = 'ContentTypeNotSupportedError';
    this.statusCode = httpDetails?.statusCode;
    this.headers = httpDetails?.headers;
  }
}

export class InvalidAgentResponseError extends Error {
  /** The HTTP status code from the response, if the error originated from an HTTP transport. */
  statusCode?: number;
  /** Selected HTTP response headers, if the error originated from an HTTP transport. */
  headers?: Record<string, string>;

  constructor(message?: string, httpDetails?: A2AErrorHttpDetails) {
    super(message ?? 'Invalid agent response type');
    this.name = 'InvalidAgentResponseError';
    this.statusCode = httpDetails?.statusCode;
    this.headers = httpDetails?.headers;
  }
}

export class AuthenticatedExtendedCardNotConfiguredError extends Error {
  /** The HTTP status code from the response, if the error originated from an HTTP transport. */
  statusCode?: number;
  /** Selected HTTP response headers, if the error originated from an HTTP transport. */
  headers?: Record<string, string>;

  constructor(message?: string, httpDetails?: A2AErrorHttpDetails) {
    super(message ?? 'Authenticated Extended Card not configured');
    this.name = 'AuthenticatedExtendedCardNotConfiguredError';
    this.statusCode = httpDetails?.statusCode;
    this.headers = httpDetails?.headers;
  }
}

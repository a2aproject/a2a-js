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

// Transport-agnostic errors according to https://a2a-protocol.org/v0.3.0/specification/#82-a2a-specific-errors.
// Due to a name conflict with legacy JSON-RPC types reexported from src/index.ts
// below errors are going to be exported via src/client/index.ts to allow usage
// from external transport implementations.

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

export class AuthenticatedExtendedCardNotConfiguredError extends Error {
  constructor(message?: string) {
    super(message ?? 'Authenticated Extended Card not configured');
    this.name = 'AuthenticatedExtendedCardNotConfiguredError';
  }
}

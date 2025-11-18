// Transport-agnostic errors according to https://a2a-protocol.org/latest/specification/#82-a2a-specific-errors;

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

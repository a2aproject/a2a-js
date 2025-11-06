import * as schema from "../types.js";

/**
 * Custom error class for A2A server operations, incorporating JSON-RPC error codes.
 */
export class A2AError extends Error {
  public code: number;
  public data?: Record<string, unknown>;
  public taskId?: string; // Optional task ID context

  constructor(
    code: number,
    message: string,
    data?: Record<string, unknown>,
    taskId?: string
  ) {
    super(message);
    this.name = "A2AError";
    this.code = code;
    this.data = data;
    this.taskId = taskId; // Store associated task ID if provided
  }

  /**
   * Formats the error into a standard JSON-RPC error object structure.
   */
  toJSONRPCError(): schema.JSONRPCError {
    const errorObject: schema.JSONRPCError = {
      code: this.code,
      message: this.message,
    };

    if(this.data !== undefined) {
      errorObject.data = this.data;
    }
 
    return errorObject;
  }

  // Static factory methods for common errors

  static parseError(message: string, data?: Record<string, unknown>): A2AError {
    return new A2AError(-32700, message, data);
  }

  static invalidRequest(message: string, data?: Record<string, unknown>): A2AError {
    return new A2AError(-32600, message, data);
  }

  static methodNotFound(method: string): A2AError {
    return new A2AError(
      -32601,
      `Method not found: ${method}`
    );
  }

  static invalidParams(message: string, data?: Record<string, unknown>): A2AError {
    return new A2AError(-32602, message, data);
  }

  static internalError(message: string, data?: Record<string, unknown>): A2AError {
    return new A2AError(-32603, message, data);
  }

  static taskNotFound(taskId: string): A2AError {
    return new A2AError(
      -32001,
      `Task not found: ${taskId}`,
      undefined,
      taskId
    );
  }

  static taskNotCancelable(taskId: string): A2AError {
    return new A2AError(
      -32002,
      `Task not cancelable: ${taskId}`,
      undefined,
      taskId
    );
  }

  static pushNotificationNotSupported(): A2AError {
    return new A2AError(
      -32003,
      "Push Notification is not supported"
    );
  }

  static unsupportedOperation(operation: string): A2AError {
    return new A2AError(
      -32004,
      `Unsupported operation: ${operation}`
    );
  }

  static authenticatedExtendedCardNotConfigured(): A2AError {
    return new A2AError(
      -32007,
      `Extended card not configured.`
    );
  }
}

// Transport-agnostic errors according to https://a2a-protocol.org/latest/specification/#82-a2a-specific-errors;

export class TaskNotFoundError extends Error {
  constructor(message?: string) {
    super(message ?? "Task not found");
    this.name = "TaskNotFoundError";
  }
}

export class TaskNotCancelableError	extends Error {
  constructor(message?: string) {
    super(message ?? "Task cannot be canceled");
    this.name = "TaskNotCancelableError";
  }
}

export class PushNotificationNotSupportedError extends Error {
  constructor(message?: string) {
    super(message ?? "Push Notification is not supported");
    this.name = "PushNotificationNotSupportedError";
  }
}

export class UnsupportedOperationError extends Error {
  constructor(message?: string) {
    super(message ?? "This operation is not supported");
    this.name = "UnsupportedOperationError";
  }
}

export class ContentTypeNotSupportedError extends Error {
  constructor(message?: string) {
    super(message ?? "Incompatible content types");
    this.name = "ContentTypeNotSupportedError";
  }
}

export class InvalidAgentResponseError extends Error {
  constructor(message?: string) {
    super(message ?? "Invalid agent response type");
    this.name = "InvalidAgentResponseError";
  }
}

export class AuthenticatedExtendedCardNotConfiguredError extends Error {
  constructor(message?: string) {
    super(message ?? "Authenticated Extended Card not configured");
    this.name = "AuthenticatedExtendedCardNotConfiguredError";
  }
}
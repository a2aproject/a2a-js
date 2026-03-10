/**
 * HTTP+JSON (REST) Transport Handler
 *
 * Accepts both snake_case (REST) and camelCase (internal) input.
 * Returns camelCase (internal types).
 */

import { A2AError } from '../../error.js';
import { A2ARequestHandler } from '../../request_handler/a2a_request_handler.js';
import { ServerCallContext } from '../../context.js';
import {
  Message,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  MessageSendParams,
  TaskPushNotificationConfig,
  TaskQueryParams,
  TaskIdParams,
  AgentCard,
} from '../../../types.js';
import { A2A_ERROR_CODE } from '../../../errors.js';

// ============================================================================
// HTTP Status Codes and Error Mapping
// ============================================================================

/**
 * HTTP status codes used in REST responses.
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
} as const;

/**
 * Maps A2A error codes to appropriate HTTP status codes.
 *
 * @param errorCode - A2A error code (e.g., -32700, -32600, -32602, etc.)
 * @returns Corresponding HTTP status code
 *
 * @example
 * mapErrorToStatus(-32602) // returns 400 (Bad Request)
 * mapErrorToStatus(-32001) // returns 404 (Not Found)
 */
export function mapErrorToStatus(errorCode: number): number {
  switch (errorCode) {
    case A2A_ERROR_CODE.PARSE_ERROR:
    case A2A_ERROR_CODE.INVALID_REQUEST:
    case A2A_ERROR_CODE.INVALID_PARAMS:
      return HTTP_STATUS.BAD_REQUEST;
    case A2A_ERROR_CODE.METHOD_NOT_FOUND:
    case A2A_ERROR_CODE.TASK_NOT_FOUND:
      return HTTP_STATUS.NOT_FOUND;
    case A2A_ERROR_CODE.TASK_NOT_CANCELABLE:
      return HTTP_STATUS.CONFLICT;
    case A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED:
    case A2A_ERROR_CODE.UNSUPPORTED_OPERATION:
      return HTTP_STATUS.BAD_REQUEST;
    default:
      return HTTP_STATUS.INTERNAL_SERVER_ERROR;
  }
}

// ============================================================================
// HTTP Error Conversion
// ============================================================================

/**
 * Converts an A2AError to HTTP+JSON transport format.
 * This conversion is private to the HTTP transport layer - errors are currently
 * tied to JSON-RPC format in A2AError, but for HTTP transport we need a simpler
 * format without the JSON-RPC wrapper.
 *
 * @param error - The A2AError to convert
 * @returns Error object with code, message, and optional data
 */
export function toHTTPError(error: A2AError): {
  code: number;
  message: string;
  data?: Record<string, unknown>;
} {
  const errorObject: { code: number; message: string; data?: Record<string, unknown> } = {
    code: error.code,
    message: error.message,
  };

  if (error.data !== undefined) {
    errorObject.data = error.data;
  }

  return errorObject;
}

// ============================================================================
// REST Transport Handler Class
// ============================================================================

/**
 * Handles REST transport layer, routing requests to A2ARequestHandler.
 * Performs type conversion, validation, and capability checks.
 * Similar to JsonRpcTransportHandler but for HTTP+JSON (REST) protocol.
 *
 * Accepts both snake_case and camelCase inputs.
 * Outputs camelCase for spec compliance.
 */
export class RestTransportHandler {
  private requestHandler: A2ARequestHandler;

  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
  }

  // ==========================================================================
  // Public API Methods
  // ==========================================================================

  /**
   * Gets the agent card (for capability checks).
   */
  async getAgentCard(): Promise<AgentCard> {
    return this.requestHandler.getAgentCard();
  }

  /**
   * Gets the authenticated extended agent card.
   */
  async getAuthenticatedExtendedAgentCard(context: ServerCallContext): Promise<AgentCard> {
    return this.requestHandler.getAuthenticatedExtendedAgentCard(context);
  }

  /**
   * Sends a message to the agent.
   */
  async sendMessage(
    params: MessageSendParams,
    context: ServerCallContext
  ): Promise<Message | Task> {
    if (!params.message) {
      throw A2AError.invalidParams('message is required');
    }
    if (!params.message.messageId) {
      throw A2AError.invalidParams('message.messageId is required');
    }
    return this.requestHandler.sendMessage(params, context);
  }

  /**
   * Sends a message with streaming response.
   * @throws {A2AError} UnsupportedOperation if streaming not supported
   */
  async sendMessageStream(
    params: MessageSendParams,
    context: ServerCallContext
  ): Promise<
    AsyncGenerator<
      Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
      void,
      undefined
    >
  > {
    await this.requireCapability('streaming');
    if (!params.message) {
      throw A2AError.invalidParams('message is required');
    }
    if (!params.message.messageId) {
      throw A2AError.invalidParams('message.messageId is required');
    }
    return this.requestHandler.sendMessageStream(params, context);
  }

  /**
   * Gets a task by ID.
   * Validates historyLength parameter if provided.
   */
  async getTask(
    taskId: string,
    context: ServerCallContext,
    historyLength?: unknown
  ): Promise<Task> {
    const params: TaskQueryParams = { id: taskId };
    if (historyLength !== undefined) {
      params.historyLength = this.parseHistoryLength(historyLength);
    }
    return this.requestHandler.getTask(params, context);
  }

  /**
   * Cancels a task.
   */
  async cancelTask(taskId: string, context: ServerCallContext): Promise<Task> {
    const params: TaskIdParams = { id: taskId };
    return this.requestHandler.cancelTask(params, context);
  }

  /**
   * Resubscribes to task updates.
   * Returns camelCase stream of task updates.
   * @throws {A2AError} UnsupportedOperation if streaming not supported
   */
  async resubscribe(
    taskId: string,
    context: ServerCallContext
  ): Promise<
    AsyncGenerator<Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined>
  > {
    await this.requireCapability('streaming');
    const params: TaskIdParams = { id: taskId };
    return this.requestHandler.resubscribe(params, context);
  }

  /**
   * Sets a push notification configuration.
   * @throws {A2AError} PushNotificationNotSupported if push notifications not supported
   */
  async setTaskPushNotificationConfig(
    config: TaskPushNotificationConfig,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    await this.requireCapability('pushNotifications');
    if (!config.taskId) {
      throw A2AError.invalidParams('taskId is required');
    }
    if (!config.pushNotificationConfig) {
      throw A2AError.invalidParams('pushNotificationConfig is required');
    }
    return this.requestHandler.setTaskPushNotificationConfig(config, context);
  }

  /**
   * Lists all push notification configurations for a task.
   */
  async listTaskPushNotificationConfigs(
    taskId: string,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig[]> {
    return this.requestHandler.listTaskPushNotificationConfigs({ id: taskId }, context);
  }

  /**
   * Gets a specific push notification configuration.
   */
  async getTaskPushNotificationConfig(
    taskId: string,
    configId: string,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    return this.requestHandler.getTaskPushNotificationConfig(
      { id: taskId, pushNotificationConfigId: configId },
      context
    );
  }

  /**
   * Deletes a push notification configuration.
   */
  async deleteTaskPushNotificationConfig(
    taskId: string,
    configId: string,
    context: ServerCallContext
  ): Promise<void> {
    await this.requestHandler.deleteTaskPushNotificationConfig(
      { id: taskId, pushNotificationConfigId: configId },
      context
    );
  }

  /**
   * Static map of capability to error for missing capabilities.
   */
  private static readonly CAPABILITY_ERRORS: Record<
    'streaming' | 'pushNotifications',
    () => A2AError
  > = {
    streaming: () => A2AError.unsupportedOperation('Agent does not support streaming'),
    pushNotifications: () => A2AError.pushNotificationNotSupported(),
  };

  /**
   * Validates that the agent supports a required capability.
   * @throws {A2AError} UnsupportedOperation for streaming, PushNotificationNotSupported for push notifications
   */
  private async requireCapability(capability: 'streaming' | 'pushNotifications'): Promise<void> {
    const agentCard = await this.getAgentCard();
    if (!agentCard.capabilities?.[capability]) {
      throw RestTransportHandler.CAPABILITY_ERRORS[capability]();
    }
  }

  /**
   * Parses and validates historyLength query parameter.
   */
  private parseHistoryLength(value: unknown): number {
    if (value === undefined || value === null) {
      throw A2AError.invalidParams('historyLength is required');
    }
    const parsed = parseInt(String(value), 10);
    if (isNaN(parsed)) {
      throw A2AError.invalidParams('historyLength must be a valid integer');
    }
    if (parsed < 0) {
      throw A2AError.invalidParams('historyLength must be non-negative');
    }
    return parsed;
  }
}

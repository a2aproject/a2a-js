/**
 * HTTP+JSON (REST) Transport Handler
 *
 * Accepts both snake_case (REST) and camelCase (internal) input.
 * Returns camelCase (internal types).
 */

import { A2ARequestHandler } from '../../request_handler/a2a_request_handler.js';
import { ServerCallContext } from '../../context.js';
import {
  Message,
  Task,
  TaskPushNotificationConfig,
  AgentCard,
  SendMessageRequest,
  StreamResponse,
  GetTaskRequest,
  CancelTaskRequest,
  GetExtendedAgentCardRequest,
  ListTasksRequest,
  ListTasksResponse,
  TaskState,
  ListTaskPushNotificationConfigsResponse,
} from '../../../index.js';
import {
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
} from '../../../errors.js';

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
 * Maps varying errors to appropriate HTTP status codes.
 *
 * @param error - The actual error instance
 * @returns Corresponding HTTP status code
 */
export function mapErrorToStatus(error: unknown): number {
  if (error instanceof TaskNotFoundError) return HTTP_STATUS.NOT_FOUND;
  if (error instanceof TaskNotCancelableError) return HTTP_STATUS.CONFLICT;
  if (error instanceof PushNotificationNotSupportedError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof UnsupportedOperationError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof ContentTypeNotSupportedError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof ExtendedAgentCardNotConfiguredError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof ExtensionSupportRequiredError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof VersionNotSupportedError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof RequestMalformedError) return HTTP_STATUS.BAD_REQUEST;
  return HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

// ============================================================================
// HTTP Error Conversion
// ============================================================================

/**
 * Converts any Error to an HTTP+JSON transport format.
 *
 * @param error - The error to convert
 * @returns Error payload
 */
export function toHTTPError(error: unknown): {
  name: string;
  message: string;
} {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
  };
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
  async getAuthenticatedExtendedAgentCard(
    params: GetExtendedAgentCardRequest,
    context: ServerCallContext
  ): Promise<AgentCard> {
    return this.requestHandler.getAuthenticatedExtendedAgentCard(params, context);
  }

  /**
   * Validates the message send parameters.
   */
  private validateSendMessageRequest(params: SendMessageRequest): void {
    if (!params.message) {
      throw new RequestMalformedError('message is required');
    }
    if (!params.message.messageId) {
      throw new RequestMalformedError('message.messageId is required');
    }
  }

  /**
   * Sends a message to the agent.
   */
  async sendMessage(
    params: SendMessageRequest,
    context: ServerCallContext
  ): Promise<Message | Task> {
    this.validateSendMessageRequest(params);
    return this.requestHandler.sendMessage(params, context);
  }

  /**
   * Sends a message with streaming response.
   * @throws {A2AError} UnsupportedOperation if streaming not supported
   */
  async sendMessageStream(
    params: SendMessageRequest,
    context: ServerCallContext
  ): Promise<AsyncGenerator<StreamResponse, void, undefined>> {
    await this.requireCapability('streaming');
    this.validateSendMessageRequest(params);
    return this.requestHandler.sendMessageStream(params, context);
  }

  /**
   * Gets a task by ID.
   * Validates historyLength parameter if provided.
   */
  async getTask(
    taskId: string,
    context: ServerCallContext,
    historyLength?: unknown,
    tenant?: string
  ): Promise<Task> {
    const params: GetTaskRequest = { id: taskId, historyLength: 0, tenant: tenant || '' };
    if (historyLength !== undefined) {
      params.historyLength = this.parseHistoryLength(historyLength);
    }
    return this.requestHandler.getTask(params, context);
  }

  /**
   * Cancels a task.
   */
  async cancelTask(taskId: string, context: ServerCallContext, tenant?: string): Promise<Task> {
    const params: CancelTaskRequest = { id: taskId, tenant: tenant || '', metadata: {} };
    return this.requestHandler.cancelTask(params, context);
  }

  /**
   * Lists tasks with filtering and pagination.
   */
  async listTasks(
    queryParams: Record<string, unknown>,
    context: ServerCallContext
  ): Promise<ListTasksResponse> {
    const params: ListTasksRequest = {
      tenant: (queryParams.tenant as string) || '',
      contextId: (queryParams.contextId as string) || '',
      status: queryParams.status ? Number(queryParams.status) : TaskState.TASK_STATE_UNSPECIFIED,
      pageSize: queryParams.pageSize ? Number(queryParams.pageSize) : undefined,
      pageToken: (queryParams.pageToken as string) || '',
      historyLength: queryParams.historyLength ? Number(queryParams.historyLength) : undefined,
      statusTimestampAfter: (queryParams.statusTimestampAfter as string) || undefined,
      includeArtifacts:
        queryParams.includeArtifacts === 'true' || queryParams.includeArtifacts === true,
    };

    return this.requestHandler.listTasks(params, context);
  }

  /**
   * Resubscribes to task updates.
   * Returns camelCase stream of task updates.
   * @throws {A2AError} UnsupportedOperation if streaming not supported
   */
  async resubscribe(
    taskId: string,
    context: ServerCallContext,
    tenant?: string
  ): Promise<AsyncGenerator<StreamResponse, void, undefined>> {
    await this.requireCapability('streaming');
    return this.requestHandler.resubscribe({ id: taskId, tenant: tenant || '' }, context);
  }

  /**
   * Sets a push notification configuration.
   * @throws {A2AError} PushNotificationNotSupported if push notifications not supported
   */
  async createTaskPushNotificationConfig(
    config: TaskPushNotificationConfig,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    await this.requireCapability('pushNotifications');
    if (!config.id) {
      throw new RequestMalformedError('id is required');
    }
    return this.requestHandler.createTaskPushNotificationConfig(config, context);
  }

  /**
   * Lists all push notification configurations for a task.
   */
  async listTaskPushNotificationConfigs(
    taskId: string,
    context: ServerCallContext,
    tenant?: string
  ): Promise<ListTaskPushNotificationConfigsResponse> {
    const result = await this.requestHandler.listTaskPushNotificationConfigs(
      { taskId, pageSize: 0, pageToken: '', tenant: tenant || '' },
      context
    );
    return result;
  }

  /**
   * Gets a specific push notification configuration.
   */
  async getTaskPushNotificationConfig(
    taskId: string,
    configId: string,
    context: ServerCallContext,
    tenant?: string
  ): Promise<TaskPushNotificationConfig> {
    const config = await this.requestHandler.getTaskPushNotificationConfig(
      { taskId, id: configId, tenant: tenant || '' },
      context
    );
    return config;
  }

  /**
   * Deletes a push notification configuration.
   */
  async deleteTaskPushNotificationConfig(
    taskId: string,
    configId: string,
    context: ServerCallContext,
    tenant?: string
  ): Promise<void> {
    await this.requestHandler.deleteTaskPushNotificationConfig(
      { taskId, id: configId, tenant: tenant || '' },
      context
    );
  }

  /**
   * Static map of capability to error for missing capabilities.
   */
  private static readonly CAPABILITY_ERRORS: Record<
    'streaming' | 'pushNotifications',
    () => Error
  > = {
    streaming: () => new UnsupportedOperationError('Agent does not support streaming'),
    pushNotifications: () => new PushNotificationNotSupportedError(),
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
      throw new RequestMalformedError('historyLength is required');
    }
    const parsed = parseInt(String(value), 10);
    if (isNaN(parsed)) {
      throw new RequestMalformedError('historyLength must be a valid integer');
    }
    if (parsed < 0) {
      throw new RequestMalformedError('historyLength must be non-negative');
    }
    return parsed;
  }
}

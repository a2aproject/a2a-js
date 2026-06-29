/**
 * HTTP+JSON (REST) transport handler. Accepts both snake_case (REST)
 * and camelCase (internal) input; returns camelCase internal types.
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
import { taskStateFromJSON } from '../../../types/pb/a2a.js';
import {
  buildErrorInfo,
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  getGrpcStatusName,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
  type ErrorDetail,
  type RestErrorBody,
} from '../../../errors.js';

/** HTTP status codes used in REST responses. */
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

/** Maps an error instance to its HTTP status code. */
export function mapErrorToStatus(error: unknown): number {
  if (error instanceof TaskNotFoundError) return HTTP_STATUS.NOT_FOUND;
  if (error instanceof TaskNotCancelableError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof PushNotificationNotSupportedError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof UnsupportedOperationError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof ContentTypeNotSupportedError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof InvalidAgentResponseError) return HTTP_STATUS.INTERNAL_SERVER_ERROR;
  if (error instanceof ExtendedAgentCardNotConfiguredError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof ExtensionSupportRequiredError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof VersionNotSupportedError) return HTTP_STATUS.BAD_REQUEST;
  if (error instanceof RequestMalformedError) return HTTP_STATUS.BAD_REQUEST;
  return HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

/**
 * Converts an error to a `google.rpc.Status` JSON response body, with
 * `google.rpc.ErrorInfo` in `details` when the error has a known reason.
 */
export function toHTTPError(error: unknown, httpStatus: number): RestErrorBody {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  const status = getGrpcStatusName(error, httpStatus);
  const details: ErrorDetail[] = [];

  if (error instanceof Error) {
    const errorInfo = buildErrorInfo(error);
    if (errorInfo) {
      details.push(errorInfo);
    }
  }

  return {
    error: {
      code: httpStatus,
      status,
      message,
      details,
    },
  };
}

/**
 * Handles the REST transport layer, routing requests to an
 * {@link A2ARequestHandler}. Performs type conversion, validation, and
 * capability checks.
 */
export class RestTransportHandler {
  private requestHandler: A2ARequestHandler;

  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
  }

  async getAgentCard(): Promise<AgentCard> {
    return this.requestHandler.getAgentCard();
  }

  async getAuthenticatedExtendedAgentCard(
    params: GetExtendedAgentCardRequest,
    context: ServerCallContext
  ): Promise<AgentCard> {
    return this.requestHandler.getAuthenticatedExtendedAgentCard(params, context);
  }

  private validateSendMessageRequest(params: SendMessageRequest): void {
    if (!params.message) {
      throw new RequestMalformedError('message is required');
    }
    if (!params.message.messageId) {
      throw new RequestMalformedError('message.messageId is required');
    }
  }

  async sendMessage(
    params: SendMessageRequest,
    context: ServerCallContext
  ): Promise<Message | Task> {
    this.validateSendMessageRequest(params);
    return this.requestHandler.sendMessage(params, context);
  }

  async sendMessageStream(
    params: SendMessageRequest,
    context: ServerCallContext
  ): Promise<AsyncGenerator<StreamResponse, void, undefined>> {
    await this.requireCapability('streaming');
    this.validateSendMessageRequest(params);
    return this.requestHandler.sendMessageStream(params, context);
  }

  async getTask(
    taskId: string,
    context: ServerCallContext,
    historyLength?: unknown,
    tenant?: string
  ): Promise<Task> {
    const params: GetTaskRequest = { id: taskId, tenant: tenant || '' };
    if (historyLength !== undefined) {
      params.historyLength = this.parseHistoryLength(historyLength);
    }
    return this.requestHandler.getTask(params, context);
  }

  async cancelTask(taskId: string, context: ServerCallContext, tenant?: string): Promise<Task> {
    const params: CancelTaskRequest = { id: taskId, tenant: tenant || '', metadata: {} };
    return this.requestHandler.cancelTask(params, context);
  }

  async listTasks(
    queryParams: Record<string, unknown>,
    context: ServerCallContext
  ): Promise<ListTasksResponse> {
    const params: ListTasksRequest = {
      tenant: (queryParams.tenant as string) || '',
      contextId: (queryParams.contextId as string) || '',
      status: queryParams.status
        ? taskStateFromJSON(
            isNaN(Number(queryParams.status)) ? queryParams.status : Number(queryParams.status)
          )
        : TaskState.TASK_STATE_UNSPECIFIED,
      pageSize: queryParams.pageSize ? Number(queryParams.pageSize) : undefined,
      pageToken: (queryParams.pageToken as string) || '',
      historyLength: queryParams.historyLength ? Number(queryParams.historyLength) : undefined,
      statusTimestampAfter: (queryParams.statusTimestampAfter as string) || undefined,
      includeArtifacts:
        queryParams.includeArtifacts === 'true' || queryParams.includeArtifacts === true,
    };

    return this.requestHandler.listTasks(params, context);
  }

  async resubscribe(
    taskId: string,
    context: ServerCallContext,
    tenant?: string
  ): Promise<AsyncGenerator<StreamResponse, void, undefined>> {
    await this.requireCapability('streaming');
    return this.requestHandler.resubscribe({ id: taskId, tenant: tenant || '' }, context);
  }

  async createTaskPushNotificationConfig(
    config: TaskPushNotificationConfig,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    await this.requireCapability('pushNotifications');
    return this.requestHandler.createTaskPushNotificationConfig(config, context);
  }

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

  private static readonly CAPABILITY_ERRORS: Record<
    'streaming' | 'pushNotifications',
    () => Error
  > = {
    streaming: () => new UnsupportedOperationError('Agent does not support streaming'),
    pushNotifications: () => new PushNotificationNotSupportedError(),
  };

  private async requireCapability(capability: 'streaming' | 'pushNotifications'): Promise<void> {
    const agentCard = await this.getAgentCard();
    if (!agentCard.capabilities?.[capability]) {
      throw RestTransportHandler.CAPABILITY_ERRORS[capability]();
    }
  }

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

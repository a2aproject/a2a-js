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
  Part,
  AgentCard,
  Role,
  JsonRpcTaskPushNotificationConfig,
} from '../../../index.js';
import {
  RestPart,
  PartInput,
  MessageInput,
  MessageSendParamsInput,
  TaskPushNotificationConfigInput,
  FileInput,
  FileWithBytes,
  FileWithUri,
} from './rest_types.js';
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
   * Accepts both snake_case and camelCase input, returns camelCase.
   */
  async sendMessage(
    params: MessageSendParamsInput,
    context: ServerCallContext
  ): Promise<Message | Task> {
    const normalized = this.normalizeMessageParams(params);
    return this.requestHandler.sendMessage(normalized, context);
  }

  /**
   * Sends a message with streaming response.
   * Accepts both snake_case and camelCase input, returns camelCase stream.
   * @throws {A2AError} UnsupportedOperation if streaming not supported
   */
  async sendMessageStream(
    params: MessageSendParamsInput,
    context: ServerCallContext
  ): Promise<
    AsyncGenerator<
      Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
      void,
      undefined
    >
  > {
    await this.requireCapability('streaming');
    const normalized = this.normalizeMessageParams(params);
    return this.requestHandler.sendMessageStream(normalized, context);
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
   * Accepts both snake_case and camelCase input, returns camelCase.
   * @throws {A2AError} PushNotificationNotSupported if push notifications not supported
   */
  async setTaskPushNotificationConfig(
    config: TaskPushNotificationConfigInput,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    await this.requireCapability('pushNotifications');
    const normalized = this.normalizeTaskPushNotificationConfig(config);

    // Extract taskId from name: tasks/{taskId}/pushNotificationConfigs/{configId}
    // define default regex for name parsing
    const match = normalized.name.match(/^tasks\/(.+)\/pushNotificationConfigs\/(.+)$/);
    if (!match) {
      throw A2AError.invalidParams('Invalid name format in TaskPushNotificationConfig');
    }
    const taskId = match[1];

    const jsonRpcConfig: JsonRpcTaskPushNotificationConfig = {
      taskId: taskId,
      pushNotificationConfig: normalized.pushNotificationConfig,
    };

    const result = await this.requestHandler.setTaskPushNotificationConfig(jsonRpcConfig, context);

    return {
      name: `tasks/${result.taskId}/pushNotificationConfigs/${result.pushNotificationConfig.id}`,
      pushNotificationConfig: result.pushNotificationConfig,
    };
  }

  /**
   * Lists all push notification configurations for a task.
   */
  async listTaskPushNotificationConfigs(
    taskId: string,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig[]> {
    const configs = await this.requestHandler.listTaskPushNotificationConfigs(
      { id: taskId },
      context
    );
    return configs.map((c) => ({
      name: `tasks/${c.taskId}/pushNotificationConfigs/${c.pushNotificationConfig.id}`,
      pushNotificationConfig: c.pushNotificationConfig,
    }));
  }

  /**
   * Gets a specific push notification configuration.
   */
  async getTaskPushNotificationConfig(
    taskId: string,
    configId: string,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    const config = await this.requestHandler.getTaskPushNotificationConfig(
      { id: taskId, pushNotificationConfigId: configId },
      context
    );
    return {
      name: `tasks/${config.taskId}/pushNotificationConfigs/${config.pushNotificationConfig.id}`,
      pushNotificationConfig: config.pushNotificationConfig,
    };
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

  // ==========================================================================
  // Private Transformation Methods
  // ==========================================================================
  // All type conversion between REST (snake_case) and internal (camelCase) formats

  /**
   * Validates and normalizes message parameters.
   * Accepts both snake_case and camelCase input.
   * @throws {A2AError} InvalidParams if message is missing or conversion fails
   */
  private normalizeMessageParams(input: MessageSendParamsInput): MessageSendParams {
    if (!input.message) {
      throw A2AError.invalidParams('message is required');
    }

    try {
      return this.normalizeMessageSendParams(input);
    } catch (error) {
      if (error instanceof A2AError) throw error;
      throw A2AError.invalidParams(
        error instanceof Error ? error.message : 'Invalid message parameters'
      );
    }
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

  /**
   * Normalizes Part input - accepts both snake_case and camelCase for file mimeType.
   */
  private normalizePart(part: PartInput): Part {
    // Check if it's already a Protobuf Part (has 'part' field with $case)
    if ('part' in part && part.part && '$case' in part.part) {
      return part as Part;
    }

    // Otherwise it's a RestPart (legacy kind-based)
    const p = part as RestPart;

    if (p.kind === 'text') {
      return { part: { $case: 'text', value: p.text } };
    }
    if (p.kind === 'file') {
      const file = this.normalizeFile(p.file);
      // Convert normalized file to Protobuf FilePart
      let fileValue: FileWithUri | FileWithBytes;
      if ('bytes' in file) {
        fileValue = { ...file } as FileWithBytes;
        return {
          part: {
            $case: 'file',
            value: {
              file: { $case: 'fileWithBytes', value: Buffer.from(fileValue.bytes, 'base64') },
              mimeType: fileValue.mimeType,
            },
          },
        };
      } else {
        fileValue = { ...file } as FileWithUri;
        return {
          part: {
            $case: 'file',
            value: {
              file: { $case: 'fileWithUri', value: fileValue.uri },
              mimeType: fileValue.mimeType,
            },
          },
        };
      }
    }
    return { part: { $case: 'data', value: { data: p.data } } };
  }

  /**
   * Normalizes File input - accepts both snake_case (mime_type) and camelCase (mimeType).
   * Returns intermediate internal file type (not Protobuf FilePart yet, helper for normalizePart).
   */
  private normalizeFile(f: FileInput): FileWithBytes | FileWithUri {
    // Access both formats via intersection cast
    const file = f as FileInput & { mimeType?: string; mime_type?: string };
    const mimeType = file.mimeType ?? file.mime_type ?? 'application/octet-stream';
    if ('bytes' in file) {
      return { bytes: file.bytes, mimeType, name: file.name };
    }
    return { uri: file.uri, mimeType, name: file.name };
  }

  /**
   * Normalizes Message input - accepts both snake_case and camelCase.
   */
  private normalizeMessage(input: MessageInput): Message {
    // Cast to access both formats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = input as any;
    const messageId = m.messageId ?? m.message_id;
    if (!messageId) {
      throw A2AError.invalidParams('message.messageId is required');
    }

    let content: Part[] = [];
    if (m.content && Array.isArray(m.content)) {
      content = m.content;
    } else if (m.parts && Array.isArray(m.parts)) {
      content = m.parts.map((p: PartInput) => this.normalizePart(p));
    } else {
      throw A2AError.invalidParams('message.content or message.parts must be an array');
    }

    // Map Role
    let role = Role.ROLE_UNSPECIFIED;
    if (typeof m.role === 'number') {
      role = m.role;
    } else if (m.role === 'user') {
      role = Role.ROLE_USER;
    } else if (m.role === 'agent') {
      role = Role.ROLE_AGENT;
    }

    return {
      contextId: m.contextId ?? m.context_id ?? '',
      extensions: m.extensions ?? [],
      messageId,
      metadata: m.metadata,
      content,
      role,
      taskId: m.taskId ?? m.task_id ?? '',
    };
  }

  /**
   * Normalizes MessageSendParams - accepts both snake_case and camelCase.
   */
  private normalizeMessageSendParams(input: MessageSendParamsInput): MessageSendParams {
    // Cast to access both formats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = input as any;
    const config = p.configuration;

    return {
      configuration: config
        ? {
            acceptedOutputModes: config.acceptedOutputModes ?? config.accepted_output_modes,
            blocking: config.blocking,
            historyLength: config.historyLength ?? config.history_length,
          }
        : undefined,
      message: this.normalizeMessage(p.message),
      metadata: p.metadata,
    };
  }

  /**
   * Normalizes TaskPushNotificationConfig - accepts both snake_case and camelCase.
   */
  private normalizeTaskPushNotificationConfig(
    input: TaskPushNotificationConfigInput
  ): TaskPushNotificationConfig {
    // Check if it's already a Protobuf type (has 'name')
    if ('name' in input && input.name) {
      return input as TaskPushNotificationConfig;
    }

    // Cast to access both formats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = input as any;
    const taskId = c.taskId ?? c.task_id;
    if (!taskId) {
      throw A2AError.invalidParams('taskId is required');
    }
    const pnConfig = c.pushNotificationConfig ?? c.push_notification_config;
    if (!pnConfig) {
      throw A2AError.invalidParams('pushNotificationConfig is required');
    }

    return {
      name: `tasks/${taskId}/pushNotificationConfigs/${pnConfig.id}`,
      pushNotificationConfig: pnConfig,
    };
  }
}

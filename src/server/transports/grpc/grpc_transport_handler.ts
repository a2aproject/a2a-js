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
  DeleteTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigParams,
  GetTaskPushNotificationConfigParams,
} from '../../../types.js';

export class GrpcTransportHandler {
  private requestHandler: A2ARequestHandler;

  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
  }

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
    this.requireCapability('streaming');
    return this.requestHandler.sendMessageStream(params, context);
  }

  /**
   * Gets a task by ID.
   * Validates historyLength parameter if provided.
   */
  async getTask(params: TaskQueryParams, context: ServerCallContext): Promise<Task> {
    if (params.historyLength !== undefined && params.historyLength < 0) {
      throw A2AError.invalidParams('historyLength must be non-negative');
    }
    return this.requestHandler.getTask(params, context);
  }

  /**
   * Cancels a task.
   */
  async cancelTask(params: TaskIdParams, context: ServerCallContext): Promise<Task> {
    return this.requestHandler.cancelTask(params, context);
  }

  /**
   * Resubscribes to task updates.
   * @throws {A2AError} UnsupportedOperation if streaming not supported
   */
  async resubscribe(
    params: TaskIdParams,
    context: ServerCallContext
  ): Promise<
    AsyncGenerator<Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined>
  > {
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
    this.requireCapability('pushNotifications');
    return this.requestHandler.setTaskPushNotificationConfig(config, context);
  }

  /**
   * Lists all push notification configurations for a task.
   */
  async listTaskPushNotificationConfigs(
    params: ListTaskPushNotificationConfigParams,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig[]> {
    return this.requestHandler.listTaskPushNotificationConfigs(params, context);
  }

  /**
   * Gets a specific push notification configuration.
   */
  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigParams,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig> {
    return this.requestHandler.getTaskPushNotificationConfig(params, context);
  }

  /**
   * Deletes a push notification configuration.
   */
  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams,
    context: ServerCallContext
  ): Promise<void> {
    await this.requestHandler.deleteTaskPushNotificationConfig(params, context);
  }

  /**
   * Static map of capability to error for missing capabilities.
   */
  private readonly CAPABILITY_ERRORS: Record<'streaming' | 'pushNotifications', () => A2AError> = {
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
      throw this.CAPABILITY_ERRORS[capability]();
    }
  }
}

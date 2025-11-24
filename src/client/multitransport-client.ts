import {
  MessageSendParams,
  TaskPushNotificationConfig,
  DeleteTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigParams,
  Task,
  TaskIdParams,
  TaskQueryParams,
  PushNotificationConfig,
  AgentCard,
} from '../types.js';
import { A2AStreamEventData, SendMessageResult } from './client.js';
import { Transport } from './transports/transport.js';

export interface ClientConfig {
  /**
   * Whether client prefers to poll for task updates instead of blocking until a terminal state is reached.
   * If set to true, non-streaming send message result might be a Message or a Task in any (including non-terminal) state.
   * Callers are responsible for running the polling loop. This configuration does not apply to streaming requests.
   */
  polling: boolean;

  /**
   * Specifies the default list of accepted media types to apply for all "send message" calls.
   */
  acceptedOutputModes?: string[];

  /**
   * Specifies the default push notification configuration to apply for every Task.
   */
  pushNotificationConfig?: PushNotificationConfig;
}

export class Client {
  constructor(
    private readonly transport: Transport,
    private readonly agentCard: AgentCard,
    private readonly config?: ClientConfig
  ) {}

  sendMessage(params: MessageSendParams): Promise<SendMessageResult> {
    params = this.applyClientConfig({ params, blocking: !(this.config?.polling ?? false) });
    return this.transport.sendMessage(params);
  }

  async *sendMessageStream(
    params: MessageSendParams
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    params = this.applyClientConfig({ params, blocking: true });
    if (!this.agentCard.capabilities.streaming) {
      yield this.transport.sendMessage(params);
      return;
    }
    yield* this.transport.sendMessageStream(params);
  }

  setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig
  ): Promise<TaskPushNotificationConfig> {
    return this.transport.setTaskPushNotificationConfig(params);
  }

  getTaskPushNotificationConfig(params: TaskIdParams): Promise<TaskPushNotificationConfig> {
    return this.transport.getTaskPushNotificationConfig(params);
  }

  listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigParams
  ): Promise<TaskPushNotificationConfig[]> {
    return this.transport.listTaskPushNotificationConfig(params);
  }

  deleteTaskPushNotificationConfig(params: DeleteTaskPushNotificationConfigParams): Promise<void> {
    return this.transport.deleteTaskPushNotificationConfig(params);
  }

  getTask(params: TaskQueryParams): Promise<Task> {
    return this.transport.getTask(params);
  }

  cancelTask(params: TaskIdParams): Promise<Task> {
    return this.transport.cancelTask(params);
  }

  async *resubscribeTask(
    params: TaskIdParams
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    yield* this.transport.resubscribeTask(params);
  }

  private applyClientConfig(options: {
    params: MessageSendParams;
    blocking: boolean;
  }): MessageSendParams {
    const { params, blocking } = options;
    const result = { ...params };
    if (!result.configuration) {
      result.configuration = {};
    }

    if (this.config?.acceptedOutputModes) {
      result.configuration.acceptedOutputModes = this.config.acceptedOutputModes;
    }
    if (this.config?.pushNotificationConfig) {
      result.configuration.pushNotificationConfig = this.config.pushNotificationConfig;
    }
    result.configuration.blocking = blocking;
    return result;
  }
}

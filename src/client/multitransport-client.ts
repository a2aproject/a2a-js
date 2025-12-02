import { PushNotificationNotSupportedError } from '../errors.js';
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
import { CallInterceptor, BeforeArgs, AfterArgs } from './interceptors.js';
import { Transport } from './transports/transport.js';

export interface ClientConfig {
  /**
   * Whether client prefers to poll for task updates instead of blocking until a terminal state is reached.
   * If set to true, non-streaming send message result might be a Message or a Task in any (including non-terminal) state.
   * Callers are responsible for running the polling loop. This configuration does not apply to streaming requests.
   */
  polling?: boolean;

  /**
   * Specifies the default list of accepted media types to apply for all "send message" calls.
   */
  acceptedOutputModes?: string[];

  /**
   * Specifies the default push notification configuration to apply for every Task.
   */
  pushNotificationConfig?: PushNotificationConfig;

  /**
   * Interceptors invoked for each request.
   */
  interceptors?: CallInterceptor[];
}

export interface RequestOptions {
  /**
   * Signal to abort request execution.
   */
  signal?: AbortSignal;

  // TODO: propagate extensions

  /**
   * Arbitrary data available to interceptors and transport implementation.
   */
  context: Map<string, unknown>;
}

export class Client {
  constructor(
    public readonly transport: Transport,
    public readonly agentCard: AgentCard,
    public readonly config?: ClientConfig
  ) {}

  /**
   * Sends a message to an agent to initiate a new interaction or to continue an existing one.
   * Uses blocking mode by default.
   */
  async sendMessage(
    params: MessageSendParams,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    const method = 'sendMessage';

    params = this.applyClientConfig({
      params,
      blocking: !(this.config?.polling ?? false),
    });
    const beforeArgs: BeforeArgs<'sendMessage'> = { input: { method, value: params }, options };
    await this.interceptBefore(beforeArgs);

    const result = await this.transport.sendMessage(beforeArgs.input.value, beforeArgs.options);

    const afterArgs: AfterArgs<'sendMessage'> = { result: { method, value: result }, options };
    await this.interceptAfter(afterArgs);
    return afterArgs.result.value;
  }

  /**
   * Sends a message to an agent to initiate/continue a task AND subscribes the client to real-time updates for that task.
   * Performs fallback to non-streaming if not supported by the agent.
   */
  async *sendMessageStream(
    params: MessageSendParams,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    const method = 'sendMessageStream';

    params = this.applyClientConfig({ params, blocking: true });
    const beforeArgs: BeforeArgs<'sendMessageStream'> = {
      input: { method, value: params },
      options,
    };
    await this.interceptBefore(beforeArgs);

    if (!this.agentCard.capabilities.streaming) {
      yield this.transport.sendMessage(beforeArgs.input.value, beforeArgs.options);
      return;
    }
    for await (const event of this.transport.sendMessageStream(
      beforeArgs.input.value,
      beforeArgs.options
    )) {
      const afterArgs: AfterArgs<'sendMessageStream'> = {
        result: { method, result: event },
        options: beforeArgs.options,
      };
      await this.interceptAfter(afterArgs);
      yield afterArgs.result.result;
    }
  }

  /**
   * Sets or updates the push notification configuration for a specified task.
   * Requires the server to have AgentCard.capabilities.pushNotifications: true.
   */
  async setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const method = 'setTaskPushNotificationConfig';

    if (!this.agentCard.capabilities.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }

    const beforeArgs: BeforeArgs<'setTaskPushNotificationConfig'> = {
      input: { method, value: params },
      options,
    };
    await this.interceptBefore(beforeArgs);

    const result = await this.transport.setTaskPushNotificationConfig(
      beforeArgs.input.value,
      beforeArgs.options
    );

    const afterArgs: AfterArgs<'setTaskPushNotificationConfig'> = {
      result: { method, value: result },
      options: beforeArgs.options,
    };
    await this.interceptAfter(afterArgs);
    return afterArgs.result.value;
  }

  /**
   * Retrieves the current push notification configuration for a specified task.
   * Requires the server to have AgentCard.capabilities.pushNotifications: true.
   */
  async getTaskPushNotificationConfig(
    params: TaskIdParams,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    const method = 'getTaskPushNotificationConfig';

    if (!this.agentCard.capabilities.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }

    const beforeArgs: BeforeArgs<'getTaskPushNotificationConfig'> = {
      input: { method, value: params },
      options,
    };
    await this.interceptBefore(beforeArgs);

    const result = await this.transport.getTaskPushNotificationConfig(
      beforeArgs.input.value,
      beforeArgs.options
    );

    const afterArgs: AfterArgs<'getTaskPushNotificationConfig'> = {
      result: { method, value: result },
      options: beforeArgs.options,
    };
    await this.interceptAfter(afterArgs);
    return afterArgs.result.value;
  }

  /**
   * Retrieves the associated push notification configurations for a specified task.
   * Requires the server to have AgentCard.capabilities.pushNotifications: true.
   */
  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig[]> {
    const method = 'listTaskPushNotificationConfig';

    if (!this.agentCard.capabilities.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }

    const beforeArgs: BeforeArgs<'listTaskPushNotificationConfig'> = {
      input: { method, value: params },
      options,
    };
    await this.interceptBefore(beforeArgs);

    const result = await this.transport.listTaskPushNotificationConfig(
      beforeArgs.input.value,
      beforeArgs.options
    );

    const afterArgs: AfterArgs<'listTaskPushNotificationConfig'> = {
      result: { method, value: result },
      options: beforeArgs.options,
    };
    await this.interceptAfter(afterArgs);
    return afterArgs.result.value;
  }

  /**
   * Deletes an associated push notification configuration for a task.
   */
  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<void> {
    const method = 'deleteTaskPushNotificationConfig';

    const beforeArgs: BeforeArgs<'deleteTaskPushNotificationConfig'> = {
      input: { method, value: params },
      options,
    };
    await this.interceptBefore(beforeArgs);

    await this.transport.deleteTaskPushNotificationConfig(
      beforeArgs.input.value,
      beforeArgs.options
    );

    const afterArgs: AfterArgs<'deleteTaskPushNotificationConfig'> = {
      result: { method, value: undefined },
      options: beforeArgs.options,
    };
    await this.interceptAfter(afterArgs);
    return afterArgs.result.value;
  }

  /**
   * Retrieves the current state (including status, artifacts, and optionally history) of a previously initiated task.
   */
  async getTask(params: TaskQueryParams, options?: RequestOptions): Promise<Task> {
    const method = 'getTask';

    const beforeArgs: BeforeArgs<'getTask'> = { input: { method, value: params }, options };
    await this.interceptBefore(beforeArgs);

    const result = await this.transport.getTask(beforeArgs.input.value, beforeArgs.options);

    const afterArgs: AfterArgs<'getTask'> = {
      result: { method, value: result },
      options: beforeArgs.options,
    };
    await this.interceptAfter(afterArgs);
    return afterArgs.result.value;
  }

  /**
   * Requests the cancellation of an ongoing task. The server will attempt to cancel the task,
   * but success is not guaranteed (e.g., the task might have already completed or failed, or cancellation might not be supported at its current stage).
   */
  async cancelTask(params: TaskIdParams, options?: RequestOptions): Promise<Task> {
    const method = 'cancelTask';

    const beforeArgs: BeforeArgs<'cancelTask'> = { input: { method, value: params }, options };
    await this.interceptBefore(beforeArgs);

    const result = await this.transport.cancelTask(beforeArgs.input.value, beforeArgs.options);

    const afterArgs: AfterArgs<'cancelTask'> = {
      result: { method, value: result },
      options: beforeArgs.options,
    };
    await this.interceptAfter(afterArgs);
    return afterArgs.result.value;
  }

  /**
   * Allows a client to reconnect to an updates stream for an ongoing task after a previous connection was interrupted.
   */
  async *resubscribeTask(
    params: TaskIdParams,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined> {
    const method = 'resubscribeTask';

    const beforeArgs: BeforeArgs<'resubscribeTask'> = { input: { method, value: params }, options };
    await this.interceptBefore(beforeArgs);

    for await (const event of this.transport.resubscribeTask(
      beforeArgs.input.value,
      beforeArgs.options
    )) {
      const afterArgs: AfterArgs<'resubscribeTask'> = {
        result: { method, result: event },
        options: beforeArgs.options,
      };
      await this.interceptAfter(afterArgs);
      yield afterArgs.result.result;
    }
  }

  private applyClientConfig({
    params,
    blocking,
  }: {
    params: MessageSendParams;
    blocking: boolean;
  }): MessageSendParams {
    const result = { ...params, configuration: params.configuration ?? {} };

    if (!result.configuration.acceptedOutputModes && this.config?.acceptedOutputModes) {
      result.configuration.acceptedOutputModes = this.config.acceptedOutputModes;
    }
    if (!result.configuration.pushNotificationConfig && this.config?.pushNotificationConfig) {
      result.configuration.pushNotificationConfig = this.config.pushNotificationConfig;
    }
    result.configuration.blocking ??= blocking;
    return result;
  }

  private async interceptBefore(args: BeforeArgs): Promise<void> {
    if (!this.config?.interceptors || this.config.interceptors.length === 0) {
      return;
    }
    for (const interceptor of this.config.interceptors) {
      await interceptor.before(args);
    }
  }

  private async interceptAfter(args: AfterArgs): Promise<void> {
    if (!this.config?.interceptors || this.config.interceptors.length === 0) {
      return;
    }
    for (const interceptor of this.config.interceptors) {
      await interceptor.after(args);
    }
  }
}

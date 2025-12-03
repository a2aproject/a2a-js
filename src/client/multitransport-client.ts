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
import {
  CallInterceptor,
  BeforeArgs,
  AfterArgs,
  ClientCallResult,
  ClientCallInput,
} from './interceptors.js';
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
  sendMessage(params: MessageSendParams, options?: RequestOptions): Promise<SendMessageResult> {
    params = this.applyClientConfig({
      params,
      blocking: !(this.config?.polling ?? false),
    });

    return this.executeWithInterceptors(
      { method: 'sendMessage', value: params },
      options,
      this.transport.sendMessage.bind(this.transport)
    );
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
    const beforeResult = await this.interceptBefore(beforeArgs);

    if (beforeResult) {
      const earlyReturn = beforeResult.earlyReturn.value;
      const afterArgs: AfterArgs<'sendMessageStream'> = {
        result: { method, value: earlyReturn },
        options: beforeArgs.options,
      };
      await this.interceptAfter(afterArgs, beforeResult.executed);
      yield afterArgs.result.value;
      return;
    }

    if (!this.agentCard.capabilities.streaming) {
      const result = await this.transport.sendMessage(beforeArgs.input.value, beforeArgs.options);
      const afterArgs: AfterArgs<'sendMessageStream'> = {
        result: { method, value: result },
        options: beforeArgs.options,
      };
      await this.interceptAfter(afterArgs);
      yield afterArgs.result.value;
      return;
    }
    for await (const event of this.transport.sendMessageStream(
      beforeArgs.input.value,
      beforeArgs.options
    )) {
      const afterArgs: AfterArgs<'sendMessageStream'> = {
        result: { method, value: event },
        options: beforeArgs.options,
      };
      await this.interceptAfter(afterArgs);
      yield afterArgs.result.value;
      if (afterArgs.earlyReturn) {
        return;
      }
    }
  }

  /**
   * Sets or updates the push notification configuration for a specified task.
   * Requires the server to have AgentCard.capabilities.pushNotifications: true.
   */
  setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }

    return this.executeWithInterceptors(
      { method: 'setTaskPushNotificationConfig', value: params },
      options,
      this.transport.setTaskPushNotificationConfig.bind(this.transport)
    );
  }

  /**
   * Retrieves the current push notification configuration for a specified task.
   * Requires the server to have AgentCard.capabilities.pushNotifications: true.
   */
  getTaskPushNotificationConfig(
    params: TaskIdParams,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }

    return this.executeWithInterceptors(
      { method: 'getTaskPushNotificationConfig', value: params },
      options,
      this.transport.getTaskPushNotificationConfig.bind(this.transport)
    );
  }

  /**
   * Retrieves the associated push notification configurations for a specified task.
   * Requires the server to have AgentCard.capabilities.pushNotifications: true.
   */
  listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig[]> {
    if (!this.agentCard.capabilities.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }

    return this.executeWithInterceptors(
      { method: 'listTaskPushNotificationConfig', value: params },
      options,
      this.transport.listTaskPushNotificationConfig.bind(this.transport)
    );
  }

  /**
   * Deletes an associated push notification configuration for a task.
   */
  deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<void> {
    return this.executeWithInterceptors(
      { method: 'deleteTaskPushNotificationConfig', value: params },
      options,
      this.transport.deleteTaskPushNotificationConfig.bind(this.transport)
    );
  }

  /**
   * Retrieves the current state (including status, artifacts, and optionally history) of a previously initiated task.
   */
  getTask(params: TaskQueryParams, options?: RequestOptions): Promise<Task> {
    return this.executeWithInterceptors(
      { method: 'getTask', value: params },
      options,
      this.transport.getTask.bind(this.transport)
    );
  }

  /**
   * Requests the cancellation of an ongoing task. The server will attempt to cancel the task,
   * but success is not guaranteed (e.g., the task might have already completed or failed, or cancellation might not be supported at its current stage).
   */
  cancelTask(params: TaskIdParams, options?: RequestOptions): Promise<Task> {
    return this.executeWithInterceptors(
      { method: 'cancelTask', value: params },
      options,
      this.transport.cancelTask.bind(this.transport)
    );
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
    const beforeResult = await this.interceptBefore(beforeArgs);

    if (beforeResult) {
      const earlyReturn = beforeResult.earlyReturn.value;
      const afterArgs: AfterArgs<'resubscribeTask'> = {
        result: { method, value: earlyReturn },
        options: beforeArgs.options,
      };
      await this.interceptAfter(afterArgs, beforeResult.executed);
      yield afterArgs.result.value;
      return;
    }

    for await (const event of this.transport.resubscribeTask(
      beforeArgs.input.value,
      beforeArgs.options
    )) {
      const afterArgs: AfterArgs<'resubscribeTask'> = {
        result: { method, value: event },
        options: beforeArgs.options,
      };
      await this.interceptAfter(afterArgs);
      yield afterArgs.result.value;
      if (afterArgs.earlyReturn) {
        return;
      }
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

  private async executeWithInterceptors<K extends keyof Client>(
    input: ClientCallInput<K>,
    options: RequestOptions | undefined,
    transportCall: (
      params: ClientCallInput<K>['value'],
      options?: RequestOptions
    ) => Promise<ClientCallResult<K>['value']>
  ): Promise<ClientCallResult<K>['value']> {
    const beforeArgs: BeforeArgs<K> = {
      input: input,
      options,
    };
    const beforeResult = await this.interceptBefore(beforeArgs);

    if (beforeResult) {
      const afterArgs: AfterArgs<K> = {
        result: {
          method: input.method,
          value: beforeResult.earlyReturn.value,
        } as ClientCallResult<K>,
        options: beforeArgs.options,
      };
      await this.interceptAfter(afterArgs, beforeResult.executed);
      return afterArgs.result.value;
    }

    const result = await transportCall(beforeArgs.input.value, beforeArgs.options);

    const afterArgs: AfterArgs<K> = {
      result: { method: input.method, value: result } as ClientCallResult<K>,
      options: beforeArgs.options,
    };
    await this.interceptAfter(afterArgs);

    return afterArgs.result.value;
  }

  private async interceptBefore<K extends keyof Client>(
    args: BeforeArgs<K>
  ): Promise<{ earlyReturn: ClientCallResult<K>; executed: CallInterceptor[] } | undefined> {
    if (!this.config?.interceptors || this.config.interceptors.length === 0) {
      return;
    }
    const executed: CallInterceptor[] = [];
    for (const interceptor of this.config.interceptors) {
      await interceptor.before(args);
      executed.push(interceptor);
      if (args.earlyReturn) {
        return {
          earlyReturn: args.earlyReturn,
          executed,
        };
      }
    }
  }

  private async interceptAfter<K extends keyof Client>(
    args: AfterArgs<K>,
    interceptors?: CallInterceptor[]
  ): Promise<void> {
    if (!this.config?.interceptors || this.config.interceptors.length === 0) {
      return;
    }
    for (const interceptor of interceptors ?? this.config.interceptors) {
      await interceptor.after(args);
      if (args.earlyReturn) {
        return;
      }
    }
  }
}

import { A2A_VERSION_HEADER, A2A_PROTOCOL_VERSION } from '../constants.js';
import { PushNotificationNotSupportedError } from '../errors.js';
import { TaskPushNotificationConfig, Task, AgentCard, SendMessageResult } from '../index.js';
import {
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  SendMessageConfiguration,
  SendMessageRequest,
  StreamResponse,
  SubscribeToTaskRequest,
  ListTasksRequest,
  ListTasksResponse,
} from '../types/pb/a2a.js';
import { ClientCallContext } from './context.js';
import {
  CallInterceptor,
  BeforeArgs,
  AfterArgs,
  ClientCallResult,
  ClientCallInput,
} from './interceptors.js';
import { ServiceParameters } from './service-parameters.js';
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
  pushNotificationConfig?: TaskPushNotificationConfig;

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

  /**
   * A key-value map for passing horizontally applicable context or parameters.
   * All parameters are passed to the server via underlying transports (e.g. In JsonRPC via Headers).
   */
  serviceParameters?: ServiceParameters;

  /**
   * Arbitrary data available to interceptors and transport implementation.
   */
  context?: ClientCallContext;
}

export class Client {
  /**
   * The A2A protocol version sent with every request via the A2A-Version header.
   * Derived from the agent card's matching interface protocolVersion,
   * falling back to {@link A2A_PROTOCOL_VERSION} if no match is found.
   * Clients MUST send this header per §3.6.1.
   */
  public get protocolVersion(): string {
    return this.resolveProtocolVersion();
  }

  constructor(
    public readonly transport: Transport,
    private agentCard: AgentCard,
    public readonly config?: ClientConfig
  ) {}

  /**
   * Resolves the protocol version from the agent card's supported interfaces
   * matching the current transport's protocol name. Falls back to the SDK's
   * built-in protocol version if no match is found.
   */
  private resolveProtocolVersion(): string {
    const agentInterface = this.agentCard.supportedInterfaces?.find(
      (i) => i.protocolBinding.toUpperCase() === this.transport.protocolName.toUpperCase()
    );
    return agentInterface?.protocolVersion || A2A_PROTOCOL_VERSION;
  }

  /**
   * If the current agent card supports the extended feature, it will try to fetch the extended agent card from the server,
   * Otherwise it will return the current agent card value.
   *
   * When a default tenant is configured (via `TenantTransportDecorator`, wired
   * automatically by `ClientFactory` from `AgentInterface.tenant`), the tenant
   * is applied to the request transparently.
   */
  async getAgentCard(options?: RequestOptions): Promise<AgentCard> {
    if (this.agentCard.capabilities?.extendedAgentCard) {
      this.agentCard = await this.executeWithInterceptors(
        { method: 'getAgentCard' },
        options,
        (_, options) => this.transport.getExtendedAgentCard({ tenant: '' }, options)
      );
    }
    return this.agentCard;
  }

  /**
   * Sends a message to an agent to initiate a new interaction or to continue an existing one.
   * Uses blocking mode by default.
   */
  sendMessage(params: SendMessageRequest, options?: RequestOptions): Promise<SendMessageResult> {
    params = this.applyClientConfig({
      params,
      returnImmediately: this.config?.polling ?? false,
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
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const method = 'sendMessageStream';

    params = this.applyClientConfig({ params, returnImmediately: false });
    const beforeArgs: BeforeArgs<'sendMessageStream'> = {
      input: { method, value: params },
      agentCard: this.agentCard,
      options: this.withVersionHeader(options),
    };
    const beforeResult = await this.interceptBefore(beforeArgs);

    if (beforeResult) {
      const earlyReturn = beforeResult.earlyReturn.value;
      const afterArgs: AfterArgs<'sendMessageStream'> = {
        result: { method, value: earlyReturn },
        agentCard: this.agentCard,
        options: beforeArgs.options,
      };
      await this.interceptAfter(afterArgs, beforeResult.executed);
      yield afterArgs.result.value;
      return;
    }

    if (!this.agentCard.capabilities?.streaming) {
      const result = await this.transport.sendMessage(beforeArgs.input.value, beforeArgs.options);

      let streamValue: StreamResponse;
      if ('messageId' in result) {
        streamValue = { payload: { $case: 'message', value: result } };
      } else {
        streamValue = { payload: { $case: 'task', value: result } };
      }

      const afterArgs: AfterArgs<'sendMessageStream'> = {
        result: { method, value: streamValue },
        agentCard: this.agentCard,
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
        agentCard: this.agentCard,
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
   * Creates a push notification configuration for a specified task.
   * Requires the server to have AgentCard.capabilities.pushNotifications: true.
   */
  createTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw new PushNotificationNotSupportedError();
    }

    return this.executeWithInterceptors(
      { method: 'createTaskPushNotificationConfig', value: params },
      options,
      this.transport.createTaskPushNotificationConfig.bind(this.transport)
    );
  }

  /**
   * Retrieves the current push notification configuration for a specified task.
   * Requires the server to have AgentCard.capabilities.pushNotifications: true.
   */
  getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities?.pushNotifications) {
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
    params: ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<ListTaskPushNotificationConfigsResponse> {
    if (!this.agentCard.capabilities?.pushNotifications) {
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
    params: DeleteTaskPushNotificationConfigRequest,
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
  getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task> {
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
  cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task> {
    return this.executeWithInterceptors(
      { method: 'cancelTask', value: params },
      options,
      this.transport.cancelTask.bind(this.transport)
    );
  }

  /**
   * Retrieves a list of tasks with optional filtering and pagination.
   */
  listTasks(params: ListTasksRequest, options?: RequestOptions): Promise<ListTasksResponse> {
    return this.executeWithInterceptors(
      { method: 'listTasks', value: params },
      options,
      this.transport.listTasks.bind(this.transport)
    );
  }

  /**
   * Allows a client to reconnect to an updates stream for an ongoing task after a previous connection was interrupted.
   */
  async *resubscribeTask(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const method = 'resubscribeTask';

    const beforeArgs: BeforeArgs<'resubscribeTask'> = {
      input: { method, value: params },
      agentCard: this.agentCard,
      options: this.withVersionHeader(options),
    };
    const beforeResult = await this.interceptBefore(beforeArgs);

    if (beforeResult) {
      const earlyReturn = beforeResult.earlyReturn.value;
      const afterArgs: AfterArgs<'resubscribeTask'> = {
        result: { method, value: earlyReturn },
        agentCard: this.agentCard,
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
        agentCard: this.agentCard,
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
    returnImmediately,
  }: {
    params: SendMessageRequest;
    returnImmediately: boolean;
  }): SendMessageRequest {
    const result = {
      ...params,
      configuration: params.configuration ?? ({} as SendMessageConfiguration),
    };

    result.configuration.acceptedOutputModes =
      result.configuration.acceptedOutputModes ??
      this.config?.acceptedOutputModes ??
      ([] as string[]);
    result.configuration.historyLength ??= 0;

    if (!result.configuration.taskPushNotificationConfig && this.config?.pushNotificationConfig) {
      if (params.message?.taskId !== undefined) {
        result.configuration.taskPushNotificationConfig = this.config.pushNotificationConfig;
      }
    }
    result.configuration.returnImmediately ??= returnImmediately;
    return result;
  }

  /**
   * Ensures the A2A-Version header is present in the request's service parameters.
   * Per §3.6.1: "Clients MUST send the A2A-Version header with each request."
   * User-provided service parameters take precedence over the auto-injected version.
   */
  private withVersionHeader(options: RequestOptions | undefined): RequestOptions {
    const existing = options?.serviceParameters;
    // Allow user to override the version via explicit service parameters.
    if (existing?.[A2A_VERSION_HEADER]) {
      return options!;
    }
    return {
      ...options,
      serviceParameters: {
        [A2A_VERSION_HEADER]: this.protocolVersion,
        ...existing,
      },
    };
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
      agentCard: this.agentCard,
      options: this.withVersionHeader(options),
    };
    const beforeResult = await this.interceptBefore(beforeArgs);

    if (beforeResult) {
      const afterArgs: AfterArgs<K> = {
        result: {
          method: input.method,
          value: beforeResult.earlyReturn.value,
        } as ClientCallResult<K>,
        agentCard: this.agentCard,
        options: beforeArgs.options,
      };
      await this.interceptAfter(afterArgs, beforeResult.executed);
      return afterArgs.result.value;
    }

    const result = await transportCall(beforeArgs.input.value, beforeArgs.options);

    const afterArgs: AfterArgs<K> = {
      result: { method: input.method, value: result } as ClientCallResult<K>,
      agentCard: this.agentCard,
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
    const reversedInterceptors = [...(interceptors ?? this.config?.interceptors ?? [])].reverse();
    for (const interceptor of reversedInterceptors) {
      await interceptor.after(args);
      if (args.earlyReturn) {
        return;
      }
    }
  }
}

import { withA2AVersion } from './service-parameters.js';
import { AgentCardSignatureVerifier } from '../signature.js';
import { LEGACY_HTTP_EXTENSION_HEADER } from '../compat/v0_3/index.js';
import { HTTP_EXTENSION_HEADER } from '../constants.js';
import { PushNotificationNotSupportedError } from '../errors/index.js';
import { isLegacyVersion } from '../version_utils.js';
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
import { SequentialPluginManager } from '../plugins/manager.js';
import { runCall, runStream, type CallHooks } from '../plugins/run.js';
import type {
  A2AMethodName,
  A2APlugin,
  ClientRequest,
  ClientResponse,
  PluginManager,
} from '../plugins/types.js';

/** A2A method name reported to plugins for each client method that calls the server. */
const PLUGIN_METHODS = {
  getAgentCard: 'GetExtendedAgentCard',
  sendMessage: 'SendMessage',
  sendMessageStream: 'SendStreamingMessage',
  getTask: 'GetTask',
  listTasks: 'ListTasks',
  cancelTask: 'CancelTask',
  createTaskPushNotificationConfig: 'CreateTaskPushNotificationConfig',
  getTaskPushNotificationConfig: 'GetTaskPushNotificationConfig',
  listTaskPushNotificationConfig: 'ListTaskPushNotificationConfigs',
  deleteTaskPushNotificationConfig: 'DeleteTaskPushNotificationConfig',
  resubscribeTask: 'SubscribeToTask',
} as const satisfies Record<
  Exclude<keyof Client, 'transport' | 'config' | 'protocolVersion' | 'endpoint'>,
  A2AMethodName
>;

export interface ClientConfig {
  /**
   * Whether to poll for task updates instead of blocking until a terminal
   * state is reached. When `true`, a non-streaming send result may be a
   * Message or a Task in any (including non-terminal) state, and the
   * caller is responsible for the polling loop. Does not apply to
   * streaming requests.
   */
  polling?: boolean;

  /** Default list of accepted media types for `sendMessage` calls. */
  acceptedOutputModes?: string[];

  /** Default push notification configuration applied to every Task. */
  pushNotificationConfig?: TaskPushNotificationConfig;

  /** Interceptors invoked for each request. */
  interceptors?: CallInterceptor[];

  /**
   * Plugins whose client hooks run around every call to the server, outside
   * the interceptors, in the given order. See `@a2a-js/sdk/plugins`.
   */
  plugins?: A2APlugin[];
}

export interface RequestOptions {
  /** Signal to abort request execution. */
  signal?: AbortSignal;

  /**
   * Key-value map for horizontally-applicable context. Passed to the
   * server via the underlying transport (e.g. as HTTP headers).
   */
  serviceParameters?: ServiceParameters;

  /** Arbitrary data available to interceptors and the transport. */
  context?: ClientCallContext;
}

export class Client {
  /**
   * The A2A protocol version sent with every request via the
   * `A2A-Version` header. Determined by the transport, which receives the
   * version from the matched `AgentInterface` during factory creation.
   */
  public get protocolVersion(): string {
    return this.transport.protocolVersion;
  }

  /**
   * The endpoint of the remote agent, as reported by the transport.
   * Undefined for custom transports that don't expose it.
   */
  public get endpoint(): string | undefined {
    return this.transport.endpoint;
  }

  private readonly plugins: PluginManager;
  private readonly pluginHooks: CallHooks<ClientRequest, ClientResponse>;

  constructor(
    public readonly transport: Transport,
    private agentCard: AgentCard,
    public readonly config?: ClientConfig
  ) {
    const plugins = new SequentialPluginManager(...(config?.plugins ?? []));
    this.plugins = plugins;
    this.pluginHooks = {
      before: (req) => plugins.beforeClientRequest(req),
      around: (req, next) => plugins.aroundClientRequest(req, next),
      after: (res) => plugins.afterClientRequest(res),
      response: ({ method, options }, outcome) => ({ method, options, ...outcome }),
    };
  }

  /**
   * If the current agent card supports the extended feature, fetches the
   * extended agent card from the server; otherwise returns the current
   * card.
   */
  async getAgentCard(
    options?: RequestOptions,
    verifySignature?: AgentCardSignatureVerifier
  ): Promise<AgentCard> {
    let agentCard = this.agentCard;
    if (agentCard.capabilities?.extendedAgentCard) {
      agentCard = await this.executeWithInterceptors(
        { method: 'getAgentCard' },
        options,
        (_, options) => this.transport.getExtendedAgentCard({ tenant: '' }, options)
      );
    }
    if (verifySignature) {
      await verifySignature(agentCard);
    }
    // Only replace the cached card once the caller's verifier has accepted it, so a
    // rejected card cannot drive later capability decisions.
    this.agentCard = agentCard;
    return agentCard;
  }

  /** Sends a message to an agent. Uses blocking mode by default. */
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
   * Sends a message and subscribes to real-time updates for the
   * resulting task. Falls back to non-streaming if the agent does not
   * support streaming.
   */
  async *sendMessageStream(
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    params = this.applyClientConfig({ params, returnImmediately: false });
    yield* this.streamWithPlugins('sendMessageStream', params, options, (params, options) =>
      this.sendMessageStreamThroughInterceptors(params, options)
    );
  }

  private async *sendMessageStreamThroughInterceptors(
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const method = 'sendMessageStream';

    const beforeArgs: BeforeArgs<'sendMessageStream'> = {
      input: { method, value: params },
      agentCard: this.agentCard,
      options: this.withNormalizedHeaders(options),
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
      if (!event.payload) {
        // A payload kind this SDK does not know yet. Skip it and keep reading.
        continue;
      }
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

  /** Creates a push notification configuration for a task. */
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

  /** Retrieves a push notification configuration for a task. */
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

  /** Lists push notification configurations for a task. */
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

  /** Deletes a push notification configuration for a task. */
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
   * Retrieves the current state of a previously initiated task,
   * including status, artifacts, and optionally history.
   */
  getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task> {
    return this.executeWithInterceptors(
      { method: 'getTask', value: params },
      options,
      this.transport.getTask.bind(this.transport)
    );
  }

  /**
   * Requests cancellation of an ongoing task. Success is not guaranteed
   * (the task may have already completed or be uncancelable).
   */
  cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task> {
    return this.executeWithInterceptors(
      { method: 'cancelTask', value: params },
      options,
      this.transport.cancelTask.bind(this.transport)
    );
  }

  /** Retrieves a list of tasks with optional filtering and pagination. */
  listTasks(params: ListTasksRequest, options?: RequestOptions): Promise<ListTasksResponse> {
    return this.executeWithInterceptors(
      { method: 'listTasks', value: params },
      options,
      this.transport.listTasks.bind(this.transport)
    );
  }

  /**
   * Reconnects to an updates stream for an ongoing task after a previous
   * connection was interrupted.
   */
  async *resubscribeTask(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    yield* this.streamWithPlugins('resubscribeTask', params, options, (params, options) =>
      this.resubscribeTaskThroughInterceptors(params, options)
    );
  }

  private async *resubscribeTaskThroughInterceptors(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const method = 'resubscribeTask';

    const beforeArgs: BeforeArgs<'resubscribeTask'> = {
      input: { method, value: params },
      agentCard: this.agentCard,
      options: this.withNormalizedHeaders(options),
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
      if (!event.payload) {
        // A payload kind this SDK does not know yet. Skip it and keep reading.
        continue;
      }
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
      configuration: { ...params.configuration } as SendMessageConfiguration,
    };

    result.configuration.acceptedOutputModes =
      result.configuration.acceptedOutputModes ??
      this.config?.acceptedOutputModes ??
      ([] as string[]);

    if (!result.configuration.taskPushNotificationConfig && this.config?.pushNotificationConfig) {
      if (params.message?.taskId !== undefined) {
        result.configuration.taskPushNotificationConfig = this.config.pushNotificationConfig;
      }
    }
    result.configuration.returnImmediately ??= returnImmediately;
    return result;
  }

  /**
   * Normalizes outgoing service parameters so they match the wire
   * version negotiated by the underlying transport.
   *
   * 1. Injects the `A2A-Version` header from `this.protocolVersion`,
   *    overriding any caller-supplied value.
   * 2. Rewrites the extensions header to the spelling expected by the
   *    negotiated wire version (v0.3 used `X-A2A-Extensions`; v1.0 uses
   *    `A2A-Extensions`). Callers can use the {@link withA2AExtensions}
   *    helper without knowing which transport they ended up on.
   *
   * Header names are matched case-insensitively. Within a logical group
   * the exact canonical-cased key wins; otherwise the last variant seen
   * wins. The canonical spelling beats the alias across groups. The
   * value emitted on the wire is always under the exact canonical
   * spelling for the negotiated wire version.
   */
  private withNormalizedHeaders(options: RequestOptions | undefined): RequestOptions {
    const serviceParameters = ServiceParameters.createFrom(
      options?.serviceParameters,
      withA2AVersion(this.protocolVersion)
    );

    const legacy = isLegacyVersion(this.protocolVersion);
    const canonical = legacy ? LEGACY_HTTP_EXTENSION_HEADER : HTTP_EXTENSION_HEADER;
    const alias = legacy ? HTTP_EXTENSION_HEADER : LEGACY_HTTP_EXTENSION_HEADER;
    const canonicalLower = canonical.toLowerCase();
    const aliasLower = alias.toLowerCase();

    // Collect values from any case variant of either header, then rebuild
    // the entry under the exact canonical spelling. The Object.keys snapshot
    // keeps iteration well-defined even though we delete entries inside it.
    let canonicalValue: string | undefined;
    let exactCanonicalSeen = false;
    let aliasValue: string | undefined;
    let exactAliasSeen = false;

    for (const key of Object.keys(serviceParameters)) {
      const keyLower = key.toLowerCase();
      if (keyLower === canonicalLower) {
        if (key === canonical) {
          canonicalValue = serviceParameters[key];
          exactCanonicalSeen = true;
        } else if (!exactCanonicalSeen) {
          canonicalValue = serviceParameters[key];
        }
        delete serviceParameters[key];
      } else if (keyLower === aliasLower) {
        if (key === alias) {
          aliasValue = serviceParameters[key];
          exactAliasSeen = true;
        } else if (!exactAliasSeen) {
          aliasValue = serviceParameters[key];
        }
        delete serviceParameters[key];
      }
    }

    if (canonicalValue !== undefined) {
      serviceParameters[canonical] = canonicalValue;
    } else if (aliasValue !== undefined) {
      serviceParameters[canonical] = aliasValue;
    }

    return {
      ...options,
      serviceParameters,
    };
  }

  private async executeWithInterceptors<K extends keyof typeof PLUGIN_METHODS>(
    input: ClientCallInput<K>,
    options: RequestOptions | undefined,
    transportCall: (
      params: ClientCallInput<K>['value'],
      options?: RequestOptions
    ) => Promise<ClientCallResult<K>['value']>
  ): Promise<ClientCallResult<K>['value']> {
    if (!this.plugins.hasClientHooks) {
      return this.callThroughInterceptors(input, options, transportCall);
    }
    const request = this.pluginRequest(input.method, input.value, options);
    return runCall(this.pluginHooks, request, () =>
      this.callThroughInterceptors(
        { method: input.method, value: request.payload } as ClientCallInput<K>,
        request.options,
        transportCall
      )
    );
  }

  /** Runs a streaming call through the plugins, then `open`. */
  private streamWithPlugins<P>(
    method: 'sendMessageStream' | 'resubscribeTask',
    params: P,
    options: RequestOptions | undefined,
    open: (
      params: P,
      options: RequestOptions | undefined
    ) => AsyncGenerator<StreamResponse, void, undefined>
  ): AsyncGenerator<StreamResponse, void, undefined> {
    if (!this.plugins.hasClientHooks) {
      return open(params, options);
    }
    const request = this.pluginRequest(method, params, options);
    return runStream(this.pluginHooks, request, () => open(request.payload as P, request.options));
  }

  private pluginRequest(
    method: keyof typeof PLUGIN_METHODS,
    payload: unknown,
    options: RequestOptions | undefined
  ): ClientRequest {
    return {
      method: PLUGIN_METHODS[method],
      payload,
      agentCard: this.agentCard,
      options: { ...options, serviceParameters: { ...options?.serviceParameters } },
    };
  }

  private async callThroughInterceptors<K extends keyof Client>(
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
      options: this.withNormalizedHeaders(options),
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

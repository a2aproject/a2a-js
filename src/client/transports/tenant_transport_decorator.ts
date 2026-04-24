import {
  AgentCard,
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetExtendedAgentCardRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  ListTasksRequest,
  ListTasksResponse,
  SendMessageRequest,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  TaskPushNotificationConfig,
} from '../../index.js';
import { RequestOptions } from '../multitransport-client.js';
import { Transport } from './transport.js';
import { SendMessageResult } from '../../index.js';

/**
 * A transport decorator that attaches a default tenant to all requests.
 *
 * When an `AgentInterface` declares a `tenant` value (per spec Section 4.4.6),
 * this decorator ensures every outbound request carries that tenant unless the
 * caller has already specified one. This mirrors the behavior of the Python SDK's
 * `TenantTransportDecorator`.
 *
 * The factory wires this decorator automatically when `AgentInterface.tenant` is
 * non-empty, so callers do not need to manually set tenant on every request.
 */
export class TenantTransportDecorator implements Transport {
  constructor(
    private readonly base: Transport,
    private readonly defaultTenant: string
  ) {}

  get protocolName(): string {
    return this.base.protocolName;
  }

  get protocolVersion(): string {
    return this.base.protocolVersion;
  }

  /**
   * Returns the request tenant if non-empty, otherwise falls back to the default.
   */
  private _resolveTenant(tenant: string | undefined): string {
    return tenant || this.defaultTenant;
  }

  async getExtendedAgentCard(
    params: GetExtendedAgentCardRequest,
    options?: RequestOptions
  ): Promise<AgentCard> {
    return this.base.getExtendedAgentCard(
      { ...params, tenant: this._resolveTenant(params.tenant) },
      options
    );
  }

  async sendMessage(
    params: SendMessageRequest,
    options?: RequestOptions
  ): Promise<SendMessageResult> {
    return this.base.sendMessage(
      { ...params, tenant: this._resolveTenant(params.tenant) },
      options
    );
  }

  async *sendMessageStream(
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    yield* this.base.sendMessageStream(
      { ...params, tenant: this._resolveTenant(params.tenant) },
      options
    );
  }

  async getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task> {
    return this.base.getTask({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }

  async cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task> {
    return this.base.cancelTask({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }

  async listTasks(params: ListTasksRequest, options?: RequestOptions): Promise<ListTasksResponse> {
    return this.base.listTasks({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }

  async createTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    return this.base.createTaskPushNotificationConfig(
      { ...params, tenant: this._resolveTenant(params.tenant) },
      options
    );
  }

  async getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig> {
    return this.base.getTaskPushNotificationConfig(
      { ...params, tenant: this._resolveTenant(params.tenant) },
      options
    );
  }

  async listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<ListTaskPushNotificationConfigsResponse> {
    return this.base.listTaskPushNotificationConfig(
      { ...params, tenant: this._resolveTenant(params.tenant) },
      options
    );
  }

  async deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void> {
    return this.base.deleteTaskPushNotificationConfig(
      { ...params, tenant: this._resolveTenant(params.tenant) },
      options
    );
  }

  async *resubscribeTask(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<StreamResponse, void, undefined> {
    yield* this.base.resubscribeTask(
      { ...params, tenant: this._resolveTenant(params.tenant) },
      options
    );
  }
}

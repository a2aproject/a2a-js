import { TaskPushNotificationConfig, Task, AgentCard } from '../../index.js';
import {
  SendMessageRequest,
  CancelTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskRequest,
  GetTaskPushNotificationConfigRequest,
  SubscribeToTaskRequest,
  A2AStreamEventData,
  SendMessageResult,
} from '../../index.js';
import { RequestOptions } from '../multitransport-client.js';

export interface Transport {
  get protocolName(): string;

  getExtendedAgentCard(options?: RequestOptions): Promise<AgentCard>;

  sendMessage(params: SendMessageRequest, options?: RequestOptions): Promise<SendMessageResult>;

  sendMessageStream(
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined>;

  createTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig>;

  getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig>;

  listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigsRequest,
    options?: RequestOptions
  ): Promise<ListTaskPushNotificationConfigsResponse>;

  deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void>;

  getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task>;

  cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task>;

  resubscribeTask(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined>;
}

export interface TransportFactory {
  get protocolName(): string;

  create(url: string, agentCard: AgentCard): Promise<Transport>;
}

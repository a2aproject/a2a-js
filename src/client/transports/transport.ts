import { TaskPushNotificationConfig, Task, AgentCard } from '../../index.js';
import {
  SendMessageRequest,
  CancelTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskRequest,
  GetTaskPushNotificationConfigRequest,
  SubscribeToTaskRequest,
  A2AStreamEventData,
  SendMessageResult,
  ListTasksRequest,
  ListTasksResponse,
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
  ): Promise<TaskPushNotificationConfig[]>;

  deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void>;

  getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task>;

  cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task>;

  listTasks(params: ListTasksRequest, options?: RequestOptions): Promise<ListTasksResponse>;

  resubscribeTask(
    params: SubscribeToTaskRequest,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined>;
}

export interface TransportFactory {
  get protocolName(): string;

  create(url: string, agentCard: AgentCard): Promise<Transport>;
}

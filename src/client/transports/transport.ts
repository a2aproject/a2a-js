import { TaskPushNotificationConfig, Task, AgentCard } from '../../index.js';
import {
  SendMessageRequest,
  CancelTaskRequest,
  ListTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskRequest,
  GetTaskPushNotificationConfigRequest,
  CreateTaskPushNotificationConfigRequest,
  TaskSubscriptionRequest,
} from '../../index.js';
import { A2AStreamEventData, SendMessageResult } from '../client.js';
import { RequestOptions } from '../multitransport-client.js';

export interface Transport {
  getExtendedAgentCard(options?: RequestOptions): Promise<AgentCard>;

  sendMessage(params: SendMessageRequest, options?: RequestOptions): Promise<SendMessageResult>;

  sendMessageStream(
    params: SendMessageRequest,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined>;

  setTaskPushNotificationConfig(
    params: CreateTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig>;

  getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig>;

  listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig[]>;

  deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    options?: RequestOptions
  ): Promise<void>;

  getTask(params: GetTaskRequest, options?: RequestOptions): Promise<Task>;

  cancelTask(params: CancelTaskRequest, options?: RequestOptions): Promise<Task>;

  resubscribeTask(
    params: TaskSubscriptionRequest,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined>;
}

export interface TransportFactory {
  get protocolName(): string;

  create(url: string, agentCard: AgentCard): Promise<Transport>;
}

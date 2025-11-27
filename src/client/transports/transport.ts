import {
  MessageSendParams,
  TaskPushNotificationConfig,
  TaskIdParams,
  ListTaskPushNotificationConfigParams,
  DeleteTaskPushNotificationConfigParams,
  TaskQueryParams,
  Task,
  AgentCard,
  GetTaskPushNotificationConfigParams,
} from '../../types.js';
import { A2AStreamEventData, SendMessageResult } from '../client.js';

export interface Transport {
  sendMessage(params: MessageSendParams, options?: RequestOptions): Promise<SendMessageResult>;

  sendMessageStream(
    params: MessageSendParams,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined>;

  setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig>;

  getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig>;

  listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<TaskPushNotificationConfig[]>;

  deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams,
    options?: RequestOptions
  ): Promise<void>;

  getTask(params: TaskQueryParams, options?: RequestOptions): Promise<Task>;

  cancelTask(params: TaskIdParams, options?: RequestOptions): Promise<Task>;

  resubscribeTask(
    params: TaskIdParams,
    options?: RequestOptions
  ): AsyncGenerator<A2AStreamEventData, void, undefined>;
}

export interface TransportFactory {
  get protocolName(): string;

  create(url: string, agentCard: AgentCard): Promise<Transport>;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

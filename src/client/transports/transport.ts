import {
  MessageSendParams,
  TaskPushNotificationConfig,
  TaskIdParams,
  ListTaskPushNotificationConfigParams,
  DeleteTaskPushNotificationConfigParams,
  TaskQueryParams,
  Task,
} from '../../types.js';
import { A2AStreamEventData, SendMessageResult } from '../client.js';

export interface A2ATransport {
  sendMessage(params: MessageSendParams): Promise<SendMessageResult>;
  sendMessageStream(params: MessageSendParams): AsyncGenerator<A2AStreamEventData, void, undefined>;
  setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig
  ): Promise<TaskPushNotificationConfig>;
  getTaskPushNotificationConfig(params: TaskIdParams): Promise<TaskPushNotificationConfig>;
  listTaskPushNotificationConfig(
    params: ListTaskPushNotificationConfigParams
  ): Promise<TaskPushNotificationConfig[]>;
  deleteTaskPushNotificationConfig(params: DeleteTaskPushNotificationConfigParams): Promise<void>;
  getTask(params: TaskQueryParams): Promise<Task>;
  cancelTask(params: TaskIdParams): Promise<Task>;
  resubscribeTask(params: TaskIdParams): AsyncGenerator<A2AStreamEventData, void, undefined>;
}

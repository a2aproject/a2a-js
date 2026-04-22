import {
  Message,
  AgentCard,
  Task,
  TaskPushNotificationConfig,
  ListTaskPushNotificationConfigsRequest,
  GetTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetExtendedAgentCardRequest,
  CancelTaskRequest,
  GetTaskRequest,
  SubscribeToTaskRequest,
  SendMessageRequest,
  ListTasksRequest,
  ListTasksResponse,
  ListTaskPushNotificationConfigsResponse,
  StreamResponse,
} from '../../index.js';
import { ServerCallContext } from '../context.js';

export interface A2ARequestHandler {
  getAgentCard(): Promise<AgentCard>;

  getAuthenticatedExtendedAgentCard(params: GetExtendedAgentCardRequest, context: ServerCallContext): Promise<AgentCard>;

  sendMessage(params: SendMessageRequest, context: ServerCallContext): Promise<Message | Task>;

  sendMessageStream(
    params: SendMessageRequest,
    context: ServerCallContext
  ): AsyncGenerator<StreamResponse, void, undefined>;

  getTask(params: GetTaskRequest, context: ServerCallContext): Promise<Task>;
  cancelTask(params: CancelTaskRequest, context: ServerCallContext): Promise<Task>;

  createTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig>;

  getTaskPushNotificationConfig(
    params: GetTaskPushNotificationConfigRequest,
    context: ServerCallContext
  ): Promise<TaskPushNotificationConfig>;

  listTaskPushNotificationConfigs(
    params: ListTaskPushNotificationConfigsRequest,
    context: ServerCallContext
  ): Promise<ListTaskPushNotificationConfigsResponse>;

  deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigRequest,
    context: ServerCallContext
  ): Promise<void>;

  resubscribe(
    params: SubscribeToTaskRequest,
    context: ServerCallContext
  ): AsyncGenerator<StreamResponse, void, undefined>;

  listTasks(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse>;
}

import {
  Message,
  AgentCard,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  TaskPushNotificationConfig,
  ListTaskPushNotificationConfigsRequest,
  GetTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  CancelTaskRequest,
  GetTaskRequest,
  SubscribeToTaskRequest,
  SendMessageRequest,
  ListTasksRequest,
  ListTasksResponse,
  ListTaskPushNotificationConfigsResponse,
} from '../../index.js';
import { ServerCallContext } from '../context.js';

export interface A2ARequestHandler {
  getAgentCard(): Promise<AgentCard>;

  getAuthenticatedExtendedAgentCard(context: ServerCallContext): Promise<AgentCard>;

  sendMessage(params: SendMessageRequest, context: ServerCallContext): Promise<Message | Task>;

  sendMessageStream(
    params: SendMessageRequest,
    context: ServerCallContext
  ): AsyncGenerator<
    Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
    void,
    undefined
  >;

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
  ): AsyncGenerator<Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined>;

  listTasks(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse>;
}

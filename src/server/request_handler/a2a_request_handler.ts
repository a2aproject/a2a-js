import {
  Message,
  AgentCard,
  MessageSendParams,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  TaskQueryParams,
  TaskIdParams,
  TaskPushNotificationConfig,
  GetTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigParams,
  DeleteTaskPushNotificationConfigParams,
} from '../../types.js';
import { ServerCallContext } from '../context.js';

export interface A2ARequestHandler {
  getAgentCard(): Promise<AgentCard>;

  getAuthenticatedExtendedAgentCard(context?: ServerCallContext): Promise<AgentCard>;

  sendMessage(params: MessageSendParams, context?: ServerCallContext): Promise<Message | Task>;

  sendMessageStream(
    params: MessageSendParams,
    context?: ServerCallContext
  ): AsyncGenerator<
    Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
    void,
    undefined
  >;

  getTask(params: TaskQueryParams, context?: ServerCallContext): Promise<Task>;
  cancelTask(params: TaskIdParams, context?: ServerCallContext): Promise<Task>;

  setTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    context?: ServerCallContext
  ): Promise<TaskPushNotificationConfig>;

  getTaskPushNotificationConfig(
    params: TaskIdParams | GetTaskPushNotificationConfigParams,
    context?: ServerCallContext
  ): Promise<TaskPushNotificationConfig>;

  listTaskPushNotificationConfigs(
    params: ListTaskPushNotificationConfigParams,
    context?: ServerCallContext
  ): Promise<TaskPushNotificationConfig[]>;

  deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams,
    context?: ServerCallContext
  ): Promise<void>;

  resubscribe(
    params: TaskIdParams,
    context?: ServerCallContext
  ): AsyncGenerator<Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined>;
}

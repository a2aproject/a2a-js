import {
  Message,
  AgentCard,
  MessageSendParams,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  TaskQueryParams,
  TaskIdParams,
  JsonRpcTaskPushNotificationConfig,
  GetTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigParams,
  DeleteTaskPushNotificationConfigParams,
} from '../../index.js';
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
    params: JsonRpcTaskPushNotificationConfig,
    context?: ServerCallContext
  ): Promise<JsonRpcTaskPushNotificationConfig>;

  getTaskPushNotificationConfig(
    params: TaskIdParams | GetTaskPushNotificationConfigParams,
    context?: ServerCallContext
  ): Promise<JsonRpcTaskPushNotificationConfig>;

  listTaskPushNotificationConfigs(
    params: ListTaskPushNotificationConfigParams,
    context?: ServerCallContext
  ): Promise<JsonRpcTaskPushNotificationConfig[]>;

  deleteTaskPushNotificationConfig(
    params: DeleteTaskPushNotificationConfigParams,
    context?: ServerCallContext
  ): Promise<void>;

  resubscribe(
    params: TaskIdParams,
    context?: ServerCallContext
  ): AsyncGenerator<Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined>;
}

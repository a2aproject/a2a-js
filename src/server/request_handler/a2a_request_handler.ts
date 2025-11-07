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
} from "../../types.js";
import { ServerCallContext } from "../context.js";

export interface A2ARequestHandler {
    getAgentCard(): Promise<AgentCard>;

    getAuthenticatedExtendedAgentCard(): Promise<AgentCard>;

    sendMessage(
        params: MessageSendParams,
        context: ServerCallContext,
    ): Promise<Message | Task>;

    sendMessageStream(
        params: MessageSendParams,
        context: ServerCallContext,
    ): AsyncGenerator<
        | Message
        | Task
        | TaskStatusUpdateEvent
        | TaskArtifactUpdateEvent,
        void,
        undefined
    >;

    getTask(params: TaskQueryParams): Promise<Task>;
    cancelTask(params: TaskIdParams): Promise<Task>;

    setTaskPushNotificationConfig(
        params: TaskPushNotificationConfig
    ): Promise<TaskPushNotificationConfig>;

    getTaskPushNotificationConfig(
        params: TaskIdParams | GetTaskPushNotificationConfigParams
    ): Promise<TaskPushNotificationConfig>;

    listTaskPushNotificationConfigs(
        params: ListTaskPushNotificationConfigParams
    ): Promise<TaskPushNotificationConfig[]>;

    deleteTaskPushNotificationConfig(
        params: DeleteTaskPushNotificationConfigParams
    ): Promise<void>;

    resubscribe(
        params: TaskIdParams
    ): AsyncGenerator<
        | Task
        | TaskStatusUpdateEvent
        | TaskArtifactUpdateEvent,
        void,
        undefined
    >;
}
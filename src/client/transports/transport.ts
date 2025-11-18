import {
    MessageSendParams,
    TaskPushNotificationConfig,
    TaskIdParams,
    ListTaskPushNotificationConfigParams,
    DeleteTaskPushNotificationConfigParams,
    TaskQueryParams,
    Task
} from "../../types.js";
import { A2AStreamEventData, SendMessageResult } from "../legacy.js";

export interface A2ATransport {
    sendMessage(params: MessageSendParams, signal?: AbortSignal): Promise<SendMessageResult>;
    sendMessageStream(params: MessageSendParams, signal?: AbortSignal): AsyncGenerator<A2AStreamEventData, void, undefined>;
    setTaskPushNotificationConfig(params: TaskPushNotificationConfig, signal?: AbortSignal): Promise<TaskPushNotificationConfig>;
    getTaskPushNotificationConfig(params: TaskIdParams, signal?: AbortSignal): Promise<TaskPushNotificationConfig>;
    listTaskPushNotificationConfig(params: ListTaskPushNotificationConfigParams, signal?: AbortSignal): Promise<TaskPushNotificationConfig[]>;
    deleteTaskPushNotificationConfig(params: DeleteTaskPushNotificationConfigParams, signal?: AbortSignal): Promise<void>;
    getTask(params: TaskQueryParams, signal?: AbortSignal): Promise<Task>;
    cancelTask(params: TaskIdParams, signal?: AbortSignal): Promise<Task>;
    resubscribeTask(params: TaskIdParams, signal?: AbortSignal): AsyncGenerator<A2AStreamEventData, void, undefined>;
}

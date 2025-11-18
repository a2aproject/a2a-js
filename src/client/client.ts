import { MessageSendParams, TaskPushNotificationConfig, DeleteTaskPushNotificationConfigParams, ListTaskPushNotificationConfigParams, Task, TaskIdParams, TaskQueryParams } from "../types.js";
import { A2AStreamEventData, SendMessageResult } from "./legacy.js";
import { A2ATransport } from "./transports/transport.js";

export class Client {
    private readonly _transport: A2ATransport;

    constructor(transport: A2ATransport) {
        this._transport = transport;
    }

    sendMessage(params: MessageSendParams): Promise<SendMessageResult> {
        return this._transport.sendMessage(params);
    }

    async *sendMessageStream(params: MessageSendParams): AsyncGenerator<A2AStreamEventData, void, undefined> {
        yield* this._transport.sendMessageStream(params);
    }

    setTaskPushNotificationConfig(params: TaskPushNotificationConfig): Promise<TaskPushNotificationConfig> {
        return this._transport.setTaskPushNotificationConfig(params);
    }

    getTaskPushNotificationConfig(params: TaskIdParams): Promise<TaskPushNotificationConfig> {
        return this._transport.getTaskPushNotificationConfig(params);
    }

    listTaskPushNotificationConfig(params: ListTaskPushNotificationConfigParams): Promise<TaskPushNotificationConfig[]> {
        return this._transport.listTaskPushNotificationConfig(params);
    }

    deleteTaskPushNotificationConfig(params: DeleteTaskPushNotificationConfigParams): Promise<void> {
        return this._transport.deleteTaskPushNotificationConfig(params);
    }

    getTask(params: TaskQueryParams): Promise<Task> {
        return this._transport.getTask(params);
    }

    cancelTask(params: TaskIdParams): Promise<Task> {
        return this._transport.cancelTask(params);
    }

    async *resubscribeTask(params: TaskIdParams): AsyncGenerator<A2AStreamEventData, void, undefined> {
        yield* this._transport.resubscribeTask(params);
    }
}
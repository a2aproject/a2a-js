import { Task, PushNotificationConfig } from "../../types.js";
import { PushNotificationSender } from "./push_notification_sender.js";
import { PushNotificationStore } from "./push_notification_store.js";

export interface DefaultPushNotificationSenderOptions {
    /**
     * Timeout in milliseconds for the abort controller. Defaults to 5000ms.
     */
    timeout?: number;
    /**
     * Custom header name for the token. Defaults to 'X-A2A-Notification-Token'.
     */
    tokenHeaderName?: string;
}

export class DefaultPushNotificationSender implements PushNotificationSender {

    private readonly pushNotificationStore: PushNotificationStore;
    private notificationChain: Map<string,Promise<unknown>>;
    private readonly options: Required<DefaultPushNotificationSenderOptions>;
    
    constructor(pushNotificationStore: PushNotificationStore, options: DefaultPushNotificationSenderOptions = {}) {
        this.pushNotificationStore = pushNotificationStore;
        this.notificationChain = new Map();
        this.options = {
            timeout: 5000,
            tokenHeaderName: 'X-A2A-Notification-Token',
            ...options
        };
    }

    async send(task: Task): Promise<void> {
        const pushConfigs = await this.pushNotificationStore.load(task.id);
        if (!pushConfigs || pushConfigs.length === 0) {
            return;
        }

        const lastPromise = this.notificationChain.get(task.id) ?? Promise.resolve();
        // Chain promises to ensure notifications for the same task are sent sequentially.
        // Once the promise is resolved, the Garbage Collector will clean it up if there are no other references to it.
        // This will prevent memory to linearly grow with the number of notifications sent.
        const newPromise = lastPromise.then(async () => {
            const dispatches = pushConfigs.map(async pushConfig => {
                try {
                    await this._dispatchNotification(task, pushConfig)
                } catch (error) {
                    console.error(`Error sending push notification for task_id=${task.id} to URL: ${pushConfig.url}. Error:`, error)
                }
            });
            await Promise.all(dispatches);
        })
        this.notificationChain.set(task.id, newPromise);

        newPromise.finally(() => {
            // Clean up the chain if it's the last notification
            if (this.notificationChain.get(task.id) === newPromise) {
                this.notificationChain.delete(task.id);
            }
        });
    }

    private async _dispatchNotification(
        task: Task, 
        pushConfig: PushNotificationConfig
    ): Promise<void> {
        const url = pushConfig.url;
        const controller = new AbortController();
        // Abort the request if it takes longer than the configured timeout.
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            
            if (pushConfig.token) {
                headers[this.options.tokenHeaderName] = pushConfig.token;
            }

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(task),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            console.info(`Push notification sent for task_id=${task.id} to URL: ${url}`);
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
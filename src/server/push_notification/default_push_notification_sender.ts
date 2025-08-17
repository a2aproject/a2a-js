import { Task, PushNotificationConfig } from "../../types.js";
import { PushNotificationSender } from "./push_notification_sender.js";
import { PushNotificationStore } from "./push_notification_store.js";

export class DefaultPushNotificationSender implements PushNotificationSender {

    private readonly pushNotificationStore: PushNotificationStore;
    
    constructor(pushNotificationStore: PushNotificationStore) {
        this.pushNotificationStore = pushNotificationStore;
    }

    async send(task: Task): Promise<void> {
        const pushConfigs = await this.pushNotificationStore.load(task.id);
        if (!pushConfigs || pushConfigs.length === 0) {
            return;
        }

        pushConfigs.forEach(pushConfig => {
            this._dispatchNotification(task, pushConfig)
                .then(success => {
                    if (!success) {
                        console.warn(`Push notification failed to send for task_id=${task.id} to URL: ${pushConfig.url}`);
                    }
                })
                .catch(error => {
                    console.error(`Error sending push notification for task_id=${task.id} to URL: ${pushConfig.url}. Error:`, error);
                });
        });
    }

    private async _dispatchNotification(
        task: Task, 
        pushConfig: PushNotificationConfig
    ): Promise<boolean> {
        const url = pushConfig.url;
        const controller = new AbortController();
        // Abort the request if it takes longer than 5 seconds.
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            
            if (pushConfig.token) {
                headers['X-A2A-Notification-Token'] = pushConfig.token;
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
            return true;
        } catch (error) {
            console.error(`Error sending push notification for task_id=${task.id} to URL: ${url}. Error:`, error);
            return false;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
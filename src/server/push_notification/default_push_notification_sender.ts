import { TaskPushNotificationConfig, StreamResponse } from '../../index.js';
import { ServerCallContext } from '../context.js';
import { PushNotificationSender } from './push_notification_sender.js';
import { PushNotificationStore } from './push_notification_store.js';

export interface DefaultPushNotificationSenderOptions {
  /**
   * Timeout in milliseconds for the abort controller. Defaults to 5000ms.
   */
  timeout?: number;
  /**
   * Custom header name for the legacy token. Defaults to 'X-A2A-Notification-Token'.
   * Used only when `pushConfig.token` is set and `pushConfig.authentication` is not.
   * @deprecated Use `pushConfig.authentication` with `AuthenticationInfo` instead.
   */
  tokenHeaderName?: string;
}

export class DefaultPushNotificationSender implements PushNotificationSender {
  private readonly pushNotificationStore: PushNotificationStore;
  private notificationChain: Map<string, Promise<unknown>>;
  private readonly options: Required<DefaultPushNotificationSenderOptions>;

  constructor(
    pushNotificationStore: PushNotificationStore,
    options: DefaultPushNotificationSenderOptions = {}
  ) {
    this.pushNotificationStore = pushNotificationStore;
    this.notificationChain = new Map();
    this.options = {
      timeout: 5000,
      tokenHeaderName: 'X-A2A-Notification-Token',
      ...options,
    };
  }

  async send(streamResponse: StreamResponse, context: ServerCallContext): Promise<void> {
    const taskId = this._getTaskId(streamResponse);
    const pushConfigs = await this.pushNotificationStore.load(taskId, context);
    if (!pushConfigs || pushConfigs.length === 0) {
      return;
    }

    const lastPromise = this.notificationChain.get(taskId) ?? Promise.resolve();
    // Chain promises to ensure notifications for the same task are sent sequentially.
    // Once the promise is resolved, the Garbage Collector will clean it up if there are no other references to it.
    // This will prevent memory to linearly grow with the number of notifications sent.
    const newPromise = lastPromise
      .catch(() => {})
      .then(async () => {
        const dispatches = pushConfigs.map(async (pushConfig) => {
          try {
            await this._dispatchNotification(streamResponse, pushConfig, taskId);
          } catch (error) {
            console.error(
              `Error sending push notification for task_id=${taskId} to URL: ${pushConfig.url}. Error:`,
              error
            );
          }
        });
        await Promise.all(dispatches);
      });
    this.notificationChain.set(taskId, newPromise);

    return newPromise.finally(() => {
      // Clean up the chain if it's the last notification
      if (this.notificationChain.get(taskId) === newPromise) {
        this.notificationChain.delete(taskId);
      }
    });
  }

  private _getTaskId(streamResponse: StreamResponse): string {
    const payload = streamResponse.payload;
    if (!payload) {
      throw new Error('StreamResponse payload is undefined');
    }
    switch (payload.$case) {
      case 'task':
        return payload.value.id;
      case 'statusUpdate':
      case 'artifactUpdate':
        return payload.value.taskId;
      case 'message':
        throw new Error('Push notification should not be sent for message payload.');
      default: {
        // Exhaustive check: if a new $case is added to the StreamResponse union
        // without updating this switch, TypeScript will report a compile error here.
        const _exhaustive: never = payload;
        throw new Error(`Unknown payload case: ${(_exhaustive as { $case: string }).$case}`);
      }
    }
  }

  /**
   * Builds the authentication headers for a push notification request.
   *
   * Per §4.3.3, the agent MUST include auth credentials per the push
   * notification config's `authentication` field when sending notifications.
   *
   * Priority:
   * 1. `pushConfig.authentication` (AuthenticationInfo with scheme + credentials)
   *    → sets `Authorization: <scheme> <credentials>` per RFC 9110 §11.4
   * 2. `pushConfig.token` (legacy) → sets the custom token header (deprecated)
   */
  private _buildAuthHeaders(pushConfig: TaskPushNotificationConfig): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = pushConfig.authentication;

    if (auth?.scheme != null && auth?.credentials != null) {
      headers['Authorization'] = auth.scheme + ' ' + auth.credentials;
    } else if (pushConfig.token != null) {
      headers[this.options.tokenHeaderName] = pushConfig.token;
    }

    return headers;
  }

  private async _dispatchNotification(
    streamResponse: StreamResponse,
    pushConfig: TaskPushNotificationConfig,
    taskId: string
  ): Promise<void> {
    const url = pushConfig.url;
    const controller = new AbortController();
    // Abort the request if it takes longer than the configured timeout.
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this._buildAuthHeaders(pushConfig),
        body: JSON.stringify(StreamResponse.toJSON(streamResponse)),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.info(`Push notification sent for task_id=${taskId} to URL: ${url}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

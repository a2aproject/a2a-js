import { TaskPushNotificationConfig, StreamResponse } from '../../index.js';
import { A2A_PROTOCOL_VERSION } from '../../constants.js';
import { ServerCallContext } from '../context.js';
import { PushNotificationSender } from './push_notification_sender.js';
import { PushNotificationStore, StoredPushNotificationConfig } from './push_notification_store.js';
import {
  PushNotificationSerializer,
  V1PushNotificationSerializer,
} from './push_notification_serializer.js';

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
  /**
   * Per-wire-version serializers. Keys are A2A wire versions (e.g. `'1.0'`,
   * `'0.3'`); values are the {@link PushNotificationSerializer}
   * implementations that produce the HTTP body and content type for
   * notifications going out to webhooks registered over that wire version.
   *
   * The sender always registers a built-in `'1.0'` serializer
   * ({@link V1PushNotificationSerializer}) at construction time; entries
   * supplied here override that default and add support for additional
   * versions (e.g. legacy v0.3 via the compat layer's
   * `V03PushNotificationSerializer`).
   *
   * When a stored config carries a wire version with no registered
   * serializer, the sender logs a warning and falls back to the `'1.0'`
   * serializer for that dispatch.
   */
  serializers?: Record<string, PushNotificationSerializer>;
}

export class DefaultPushNotificationSender implements PushNotificationSender {
  private readonly pushNotificationStore: PushNotificationStore;
  private notificationChain: Map<string, Promise<unknown>>;
  private readonly options: Required<Omit<DefaultPushNotificationSenderOptions, 'serializers'>>;
  private readonly serializers: Map<string, PushNotificationSerializer>;
  private readonly fallbackSerializer: PushNotificationSerializer;
  // Track wire versions we've already warned about (per sender instance) to
  // avoid log spam when many notifications target the same unknown version.
  private readonly warnedMissingSerializers: Set<string> = new Set();

  constructor(
    pushNotificationStore: PushNotificationStore,
    options: DefaultPushNotificationSenderOptions = {}
  ) {
    this.pushNotificationStore = pushNotificationStore;
    this.notificationChain = new Map();
    this.options = {
      timeout: options.timeout ?? 5000,
      tokenHeaderName: options.tokenHeaderName ?? 'X-A2A-Notification-Token',
    };

    // Seed the registry with the canonical v1.0 serializer, then overlay
    // user-supplied entries. User entries with key '1.0' override the
    // default, which is intentional (callers may want a custom v1.0
    // serializer for testing or alternative encodings).
    const builtinV1 = new V1PushNotificationSerializer();
    this.serializers = new Map<string, PushNotificationSerializer>([
      [A2A_PROTOCOL_VERSION, builtinV1],
    ]);
    if (options.serializers) {
      for (const [version, serializer] of Object.entries(options.serializers)) {
        this.serializers.set(version, serializer);
      }
    }
    // Cache the v1.0 serializer for unknown-version fallback. We resolve
    // this from the registry (not the local `builtinV1`) so a user who
    // overrode '1.0' has their custom serializer used for fallback too.
    this.fallbackSerializer = this.serializers.get(A2A_PROTOCOL_VERSION) ?? builtinV1;
  }

  async send(streamResponse: StreamResponse, context: ServerCallContext): Promise<void> {
    const taskId = this._getTaskId(streamResponse);
    const storedConfigs = await this.pushNotificationStore.load(taskId, context);
    if (!storedConfigs || storedConfigs.length === 0) {
      return;
    }

    const lastPromise = this.notificationChain.get(taskId) ?? Promise.resolve();
    // Chain promises to ensure notifications for the same task are sent sequentially.
    // Once the promise is resolved, the Garbage Collector will clean it up if there are no other references to it.
    // This will prevent memory to linearly grow with the number of notifications sent.
    const newPromise = lastPromise
      .catch(() => {})
      .then(async () => {
        const dispatches = storedConfigs.map(async (storedConfig) => {
          try {
            await this._dispatchNotification(streamResponse, storedConfig, taskId);
          } catch (error) {
            console.error(
              `Error sending push notification for task_id=${taskId} to URL: ${storedConfig.config.url}. Error:`,
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
   * Resolves the serializer registered for the given wire version.
   *
   * Falls back to the v1.0 serializer (logging a warning at most once per
   * unknown version per sender instance) if no entry is registered. The
   * fallback keeps push delivery best-effort even when a custom compat
   * layer registers webhooks under a wire version the sender wasn't
   * configured for.
   */
  private _resolveSerializer(wireVersion: string): PushNotificationSerializer {
    const serializer = this.serializers.get(wireVersion);
    if (serializer) {
      return serializer;
    }
    if (!this.warnedMissingSerializers.has(wireVersion)) {
      this.warnedMissingSerializers.add(wireVersion);
      console.warn(
        `No push notification serializer registered for wire version '${wireVersion}'; ` +
          `falling back to '${A2A_PROTOCOL_VERSION}'. Register one via ` +
          `DefaultPushNotificationSenderOptions.serializers to silence this warning.`
      );
    }
    return this.fallbackSerializer;
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
    const headers: Record<string, string> = {};

    if (pushConfig.authentication?.scheme && pushConfig.authentication?.credentials) {
      headers['Authorization'] =
        `${pushConfig.authentication.scheme} ${pushConfig.authentication.credentials}`;
    } else if (pushConfig.token) {
      headers[this.options.tokenHeaderName] = pushConfig.token;
    }

    return headers;
  }

  private async _dispatchNotification(
    streamResponse: StreamResponse,
    storedConfig: StoredPushNotificationConfig,
    taskId: string
  ): Promise<void> {
    const { config: pushConfig, wireVersion } = storedConfig;
    const url = pushConfig.url;
    const controller = new AbortController();
    // Abort the request if it takes longer than the configured timeout.
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const serializer = this._resolveSerializer(wireVersion);
      const { body, contentType } = serializer.serialize(streamResponse);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          ...this._buildAuthHeaders(pushConfig),
        },
        body,
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

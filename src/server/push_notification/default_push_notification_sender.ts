import { TaskPushNotificationConfig, StreamResponse } from '../../index.js';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  A2A_PROTOCOL_VERSION,
  ProtocolVersion,
} from '../../constants.js';
import { ServerCallContext } from '../context.js';
import { PushNotificationSender } from './push_notification_sender.js';
import { PushNotificationStore, StoredPushNotificationConfig } from './push_notification_store.js';
import {
  PushNotificationSerializer,
  V1PushNotificationSerializer,
} from './push_notification_serializer.js';

export interface DefaultPushNotificationSenderOptions {
  /** Timeout in milliseconds for the abort controller. Defaults to 5000ms. */
  timeout?: number;
  /**
   * Custom header name for the legacy token (defaults to
   * `X-A2A-Notification-Token`). Used only when `pushConfig.token` is set
   * and `pushConfig.authentication` is not.
   * @deprecated Use `pushConfig.authentication` with `AuthenticationInfo`.
   */
  tokenHeaderName?: string;
  /**
   * Per-wire-version push-notification serializers. The sender always
   * registers a built-in `'1.0'` serializer
   * ({@link V1PushNotificationSerializer}) at construction time; entries
   * supplied here override that default and add support for additional
   * versions (e.g. legacy v0.3 via the compat layer's
   * `V03PushNotificationSerializer`).
   *
   * When a stored config carries a wire version with no registered
   * serializer, the sender logs a warning and falls back to `'1.0'`.
   *
   * The typed key set is a developer affordance; the underlying registry
   * accepts any string at runtime.
   */
  serializers?: Partial<Record<ProtocolVersion, PushNotificationSerializer>>;
}

export class DefaultPushNotificationSender implements PushNotificationSender {
  private readonly pushNotificationStore: PushNotificationStore;
  private notificationChain: Map<string, Promise<unknown>>;
  private readonly options: Required<Omit<DefaultPushNotificationSenderOptions, 'serializers'>>;
  private readonly serializers: Map<string, PushNotificationSerializer>;
  private readonly fallbackSerializer: PushNotificationSerializer;
  // Avoid log spam when many notifications target the same unknown version.
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

    // Seed with the built-in v1.0 serializer, then overlay user-supplied
    // entries. User entries with key '1.0' override the default
    // (intentional — callers may want a custom v1.0 encoding).
    const builtinV1 = new V1PushNotificationSerializer();
    this.serializers = new Map<string, PushNotificationSerializer>([
      [ProtocolVersion.V1_0, builtinV1],
    ]);
    if (options.serializers) {
      for (const [version, serializer] of Object.entries(options.serializers)) {
        if (serializer) {
          this.serializers.set(version, serializer);
        }
      }
    }
    // Resolve from the registry (not `builtinV1`) so a user who overrode
    // '1.0' has their custom serializer used for fallback too.
    this.fallbackSerializer = this.serializers.get(ProtocolVersion.V1_0) ?? builtinV1;
  }

  async send(streamResponse: StreamResponse, context: ServerCallContext): Promise<void> {
    const taskId = this._getTaskId(streamResponse);
    // Stand-alone messages with no task association can't have a
    // registered push config — skip the store round-trip.
    if (!taskId) {
      return;
    }

    const storedConfigs = await this._loadStoredConfigs(taskId, context);
    if (!storedConfigs || storedConfigs.length === 0) {
      return;
    }

    const lastPromise = this.notificationChain.get(taskId) ?? Promise.resolve();
    // Chain promises so notifications for the same task are sent
    // sequentially; once resolved the GC can clean them up so memory
    // doesn't grow linearly with the number of notifications sent.
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
      if (this.notificationChain.get(taskId) === newPromise) {
        this.notificationChain.delete(taskId);
      }
    });
  }

  /**
   * Returns the task id associated with a {@link StreamResponse}.
   * Returns an empty string for stand-alone messages with no task
   * association; the sender skips dispatch in that case.
   */
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
      case 'message':
        return payload.value.taskId;
      default: {
        const _exhaustive: never = payload;
        throw new Error(`Unknown payload case: ${(_exhaustive as { $case: string }).$case}`);
      }
    }
  }

  /**
   * Resolves stored configs from the {@link PushNotificationStore},
   * preferring the wire-version-aware
   * {@link PushNotificationStore.loadWithMetadata} when available.
   *
   * Stores that only implement the canonical {@link PushNotificationStore.load}
   * are silently lifted into the wrapped shape by tagging every entry
   * with the wire version of the *triggering* request. See
   * `src/compat/v0_3/README.md` for the implication on v1.0 deployments
   * with v0.3 compat opted in.
   */
  private async _loadStoredConfigs(
    taskId: string,
    context: ServerCallContext
  ): Promise<StoredPushNotificationConfig[]> {
    if (this.pushNotificationStore.loadWithMetadata) {
      return await this.pushNotificationStore.loadWithMetadata(taskId, context);
    }
    const plain = await this.pushNotificationStore.load(taskId, context);
    const fallbackVersion = context.requestedVersion || A2A_LEGACY_PROTOCOL_VERSION;
    return plain.map((config) => ({ config, wireVersion: fallbackVersion }));
  }

  /**
   * Resolves the serializer registered for the given wire version,
   * falling back to v1.0 (with a one-time warning) when no entry is
   * registered.
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
   * Builds the auth headers for a push notification request. Priority:
   * `pushConfig.authentication` (scheme + credentials) → `Authorization`
   * header; otherwise `pushConfig.token` → legacy token header.
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

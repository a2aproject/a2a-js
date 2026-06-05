import { TaskPushNotificationConfig } from '../../index.js';
import { A2A_PROTOCOL_VERSION } from '../../constants.js';
import { ServerCallContext } from '../context.js';
import { OwnerResolver, resolveUserScope } from '../owner_resolver.js';
import { ScopedStore } from '../utils.js';

/**
 * A push-notification config bundled with the A2A wire version it was
 * originally registered over.
 *
 * The wire version is captured at registration time from
 * `ServerCallContext.requestedVersion` so the sender can later look up the
 * right {@link PushNotificationSerializer} when dispatching webhooks, even
 * though the original request has long since returned.
 *
 * The wire version is the value passed by the transport (e.g. `'1.0'`,
 * `'0.3'`). When the transport did not populate `requestedVersion` the
 * stored value defaults to `'0.3'`, mirroring the
 * `ABSENT_HEADER_VERSION` rule on `ServerCallContext` (§3.6.2).
 */
export interface StoredPushNotificationConfig {
  /** The push-notification config as supplied by the client. */
  config: TaskPushNotificationConfig;
  /** The A2A wire version the config was registered over. */
  wireVersion: string;
}

/**
 * Interface for push notification configuration storage.
 *
 * Implementations SHOULD use `context.tenant` (when present) and the authenticated
 * caller's identity to scope data access, ensuring push notification configs from
 * one tenant or user are not accessible to another.
 * Per spec §13.1, servers MUST verify the client has appropriate access rights
 * for push notification configuration operations.
 *
 * Implementations MUST persist the originating wire version alongside each
 * config (read from `context.requestedVersion` at save time) and surface it
 * to {@link load} consumers so the push-notification sender can route to the
 * correct {@link PushNotificationSerializer}.
 */
export interface PushNotificationStore {
  save(
    taskId: string,
    context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig
  ): Promise<void>;
  load(taskId: string, context: ServerCallContext): Promise<StoredPushNotificationConfig[]>;
  delete(taskId: string, context: ServerCallContext, configId?: string): Promise<void>;
}

/**
 * In-memory push notification config store with tenant- and owner-scoped data isolation.
 * A triple-nested Map structure (tenant -> owner -> taskId -> configs[]) is used so that
 * both tenant and owner scoping are structural, imposing no restrictions on task ID format.
 *
 * Per spec §13.1, servers MUST ensure appropriate scope limitation based on the
 * authenticated caller's authorization boundaries.
 *
 * Each entry persists the A2A wire version (`context.requestedVersion`) it was
 * registered over so the sender can serialize back to the same wire format.
 */
export class InMemoryPushNotificationStore implements PushNotificationStore {
  private readonly _scopedStore: ScopedStore<StoredPushNotificationConfig[]>;

  constructor(ownerResolver: OwnerResolver = resolveUserScope) {
    this._scopedStore = new ScopedStore<StoredPushNotificationConfig[]>(ownerResolver);
  }

  async save(
    taskId: string,
    context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig
  ): Promise<void> {
    const bucket = this._scopedStore.getOrCreateBucket(context);
    const entries = bucket.get(taskId) || [];

    // Set ID if it's not already set
    if (!pushNotificationConfig.id) {
      pushNotificationConfig.id = taskId;
    }

    // Capture the wire version from the request context. ServerCallContext
    // always populates this field (defaulting to A2A_LEGACY_PROTOCOL_VERSION
    // when the A2A-Version header is absent, per §3.6.2), so the fallback to
    // A2A_PROTOCOL_VERSION below is defensive only and applies if a caller
    // somehow constructs an entry without going through the normal context.
    const wireVersion = context.requestedVersion || A2A_PROTOCOL_VERSION;

    // Remove existing entry with the same config ID if it exists
    const existingIndex = entries.findIndex(
      (entry) => entry.config.id === pushNotificationConfig.id
    );
    if (existingIndex !== -1) {
      entries.splice(existingIndex, 1);
    }

    // Add the new/updated entry
    entries.push({ config: pushNotificationConfig, wireVersion });
    bucket.set(taskId, entries);
  }

  async load(taskId: string, context: ServerCallContext): Promise<StoredPushNotificationConfig[]> {
    const entries = this._scopedStore.getBucket(context)?.get(taskId);
    return entries ? [...entries] : [];
  }

  async delete(taskId: string, context: ServerCallContext, configId?: string): Promise<void> {
    // If no configId is provided, use taskId as the configId (backward compatibility)
    if (configId === undefined) {
      configId = taskId;
    }

    const bucket = this._scopedStore.getBucket(context);
    if (!bucket) {
      return;
    }

    const entries = bucket.get(taskId);
    if (!entries) {
      return;
    }

    const entryIndex = entries.findIndex((entry) => entry.config.id === configId);
    if (entryIndex !== -1) {
      entries.splice(entryIndex, 1);
    }

    if (entries.length === 0) {
      bucket.delete(taskId);
    }
  }
}

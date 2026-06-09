import { TaskPushNotificationConfig } from '../../index.js';
import { A2A_LEGACY_PROTOCOL_VERSION } from '../../constants.js';
import { ServerCallContext } from '../context.js';
import { OwnerResolver, resolveUserScope } from '../owner_resolver.js';
import { ScopedStore } from '../utils.js';

/**
 * A push-notification config bundled with the A2A wire version it was
 * originally registered over. Returned by the optional
 * {@link PushNotificationStore.loadWithMetadata} method so the
 * {@link DefaultPushNotificationSender} can route to the correct
 * push-notification serializer per dispatch.
 *
 * The wire version is the value passed by the transport (e.g. `'1.0'`,
 * `'0.3'`). When the transport did not populate
 * `ServerCallContext.requestedVersion` the stored value defaults to
 * `'0.3'`, mirroring the absent-header rule on `ServerCallContext`
 * (§3.6.2).
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
 */
export interface PushNotificationStore {
  save(
    taskId: string,
    context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig
  ): Promise<void>;

  /**
   * Loads all stored push notification configs for the given task. This is
   * the canonical, version-agnostic read path and is fully supported.
   */
  load(taskId: string, context: ServerCallContext): Promise<TaskPushNotificationConfig[]>;

  /**
   * Optional. Loads stored configs alongside the A2A wire version each was
   * originally registered over. Used by
   * {@link DefaultPushNotificationSender} to route the correct
   * push-notification serializer per dispatch.
   *
   * Implementations that don't capture the originating wire version may
   * omit this method; the sender will fall back to {@link load} and treat
   * every entry as the wire version of the request *triggering* the
   * dispatch ({@link ServerCallContext.requestedVersion}), defaulting to
   * {@link A2A_LEGACY_PROTOCOL_VERSION} (`'0.3'`) per spec §3.6.2 only
   * when the triggering context carries no version.
   *
   * Note for v0.3 compat layer users: this fallback is best-effort and
   * matches the *triggering* request's wire version, not the wire version
   * the webhook was originally registered over. In v1.0 deployments with
   * v0.3 compat opted in and backed by a custom store you SHOULD
   * implement this method so each webhook keeps receiving the body shape
   * that matches its registration. See `src/compat/v0_3/README.md` for
   * the broader caveat.
   */
  loadWithMetadata?(
    taskId: string,
    context: ServerCallContext
  ): Promise<StoredPushNotificationConfig[]>;

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
 * registered over so the sender can serialize back to the same wire format
 * via {@link loadWithMetadata}.
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
    // when the A2A-Version header is absent, per §3.6.2), so the fallback
    // below is defensive only and applies when a caller constructs an
    // entry without going through the normal context. The fallback also
    // resolves to '0.3' per §3.6.2's empty-header rule.
    const wireVersion = context.requestedVersion || A2A_LEGACY_PROTOCOL_VERSION;

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

  async load(taskId: string, context: ServerCallContext): Promise<TaskPushNotificationConfig[]> {
    const entries = this._scopedStore.getBucket(context)?.get(taskId);
    // Deep-clone each config so caller-side mutations cannot reach into the
    // store's internal bucket (defends both the array spine and inner
    // config objects).
    return entries ? entries.map((e) => structuredClone(e.config)) : [];
  }

  async loadWithMetadata(
    taskId: string,
    context: ServerCallContext
  ): Promise<StoredPushNotificationConfig[]> {
    const entries = this._scopedStore.getBucket(context)?.get(taskId);
    // Deep-clone the whole wrapper for the same reason as load(). The
    // wireVersion field is a primitive string and is copied by value.
    return entries ? entries.map((e) => structuredClone(e)) : [];
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

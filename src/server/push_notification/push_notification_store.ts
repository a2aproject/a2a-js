import { v4 as uuidv4 } from 'uuid';
import { TaskPushNotificationConfig } from '../../index.js';
import { A2A_LEGACY_PROTOCOL_VERSION } from '../../constants.js';
import { ServerCallContext } from '../context.js';
import { OwnerResolver, resolveUserScope } from '../owner_resolver.js';
import { ScopedStore } from '../utils.js';

/**
 * A push-notification config bundled with the A2A wire version it was
 * originally registered over, returned by the optional
 * {@link PushNotificationStore.loadWithMetadata}. The
 * {@link DefaultPushNotificationSender} uses this to route to the
 * correct serializer per dispatch.
 */
export interface StoredPushNotificationConfig {
  /** The push-notification config as supplied by the client. */
  config: TaskPushNotificationConfig;
  /** The A2A wire version the config was registered over. */
  wireVersion: string;
}

/**
 * Interface for push notification configuration storage. Implementations
 * SHOULD use `context.tenant` (when present) and the authenticated
 * caller's identity to scope data access.
 */
export interface PushNotificationStore {
  /**
   * Implementations MUST assign a non-empty
   * `pushNotificationConfig.id` in place when the caller passes an empty
   * one (id is the *result* of Create, observed via the same reference
   * the caller passed in).
   */
  save(
    taskId: string,
    context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig
  ): Promise<void>;

  /** Loads all stored push notification configs for the given task. */
  load(taskId: string, context: ServerCallContext): Promise<TaskPushNotificationConfig[]>;

  /**
   * Optional: loads stored configs alongside the wire version each was
   * registered over. Implementations that don't capture this can omit
   * the method; the sender falls back to {@link load} and treats every
   * entry as the wire version of the *triggering* request (defaulting to
   * `'0.3'` when absent). Custom stores in v1.0 deployments with v0.3
   * compat enabled SHOULD implement this so each webhook keeps receiving
   * the body shape that matches its registration.
   */
  loadWithMetadata?(
    taskId: string,
    context: ServerCallContext
  ): Promise<StoredPushNotificationConfig[]>;

  delete(taskId: string, context: ServerCallContext, configId?: string): Promise<void>;
}

/**
 * In-memory push notification config store backed by a triple-nested Map
 * (tenant -> owner -> taskId -> configs[]). Each entry persists the wire
 * version it was registered over so the sender can serialize back to the
 * same wire format via {@link loadWithMetadata}.
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

    // id is the *result* of Create, not an input requirement — id-less
    // Creates must produce distinct records, not silently upsert.
    if (!pushNotificationConfig.id) {
      pushNotificationConfig.id = uuidv4();
    }

    // Fallback is defensive — ServerCallContext.requestedVersion always
    // populates a value when constructed via the normal transport path.
    const wireVersion = context.requestedVersion || A2A_LEGACY_PROTOCOL_VERSION;

    const existingIndex = entries.findIndex(
      (entry) => entry.config.id === pushNotificationConfig.id
    );
    if (existingIndex !== -1) {
      entries.splice(existingIndex, 1);
    }

    entries.push({ config: pushNotificationConfig, wireVersion });
    bucket.set(taskId, entries);
  }

  async load(taskId: string, context: ServerCallContext): Promise<TaskPushNotificationConfig[]> {
    const entries = this._scopedStore.getBucket(context)?.get(taskId);
    // Deep-clone so caller-side mutation can't reach into the store.
    return entries ? entries.map((e) => structuredClone(e.config)) : [];
  }

  async loadWithMetadata(
    taskId: string,
    context: ServerCallContext
  ): Promise<StoredPushNotificationConfig[]> {
    const entries = this._scopedStore.getBucket(context)?.get(taskId);
    return entries ? entries.map((e) => structuredClone(e)) : [];
  }

  async delete(taskId: string, context: ServerCallContext, configId?: string): Promise<void> {
    // Backward-compat: treat missing configId as the taskId.
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

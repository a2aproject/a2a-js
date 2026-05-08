import { TaskPushNotificationConfig } from '../../index.js';
import { ServerCallContext } from '../context.js';
import { OwnerResolver, resolveUserScope } from '../owner_resolver.js';
import { ScopedStore } from '../utils.js';

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
  load(taskId: string, context: ServerCallContext): Promise<TaskPushNotificationConfig[]>;
  delete(taskId: string, context: ServerCallContext, configId?: string): Promise<void>;
}

/**
 * In-memory push notification config store with tenant- and owner-scoped data isolation.
 * A triple-nested Map structure (tenant -> owner -> taskId -> configs[]) is used so that
 * both tenant and owner scoping are structural, imposing no restrictions on task ID format.
 *
 * Per spec §13.1, servers MUST ensure appropriate scope limitation based on the
 * authenticated caller's authorization boundaries.
 */
export class InMemoryPushNotificationStore implements PushNotificationStore {
  private readonly _scopedStore: ScopedStore<TaskPushNotificationConfig[]>;

  constructor(ownerResolver: OwnerResolver = resolveUserScope) {
    this._scopedStore = new ScopedStore<TaskPushNotificationConfig[]>(ownerResolver);
  }

  async save(
    taskId: string,
    context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig
  ): Promise<void> {
    const bucket = this._scopedStore.getOrCreateBucket(context);
    const configs = bucket.get(taskId) || [];

    // Set ID if it's not already set
    if (!pushNotificationConfig.id) {
      pushNotificationConfig.id = taskId;
    }

    // Remove existing config with the same ID if it exists
    const existingIndex = configs.findIndex((config) => config.id === pushNotificationConfig.id);
    if (existingIndex !== -1) {
      configs.splice(existingIndex, 1);
    }

    // Add the new/updated config
    configs.push(pushNotificationConfig);
    bucket.set(taskId, configs);
  }

  async load(taskId: string, context: ServerCallContext): Promise<TaskPushNotificationConfig[]> {
    const configs = this._scopedStore.getBucket(context)?.get(taskId);
    return configs || [];
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

    const configs = bucket.get(taskId);
    if (!configs) {
      return;
    }

    const configIndex = configs.findIndex((config) => config.id === configId);
    if (configIndex !== -1) {
      configs.splice(configIndex, 1);
    }

    if (configs.length === 0) {
      bucket.delete(taskId);
    }
  }
}

import { TaskPushNotificationConfig } from '../../index.js';
import { ServerCallContext } from '../context.js';

/**
 * Interface for push notification configuration storage.
 *
 * Implementations SHOULD use `context.tenant` (when present) to scope data access,
 * ensuring push notification configs from one tenant are not accessible to another.
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
 * In-memory push notification config store with tenant-scoped data isolation.
 * A nested Map structure (tenant -> taskId -> configs[]) is used so that tenant
 * scoping is structural, imposing no restrictions on task ID format.
 */
export class InMemoryPushNotificationStore implements PushNotificationStore {
  // Outer map: tenant key ('' for global/no-tenant) -> inner map of taskId -> configs
  private store: Map<string, Map<string, TaskPushNotificationConfig[]>> = new Map();

  private _tenantKey(context: ServerCallContext): string {
    return context.tenant ?? '';
  }

  private _getTenantBucket(
    context: ServerCallContext
  ): Map<string, TaskPushNotificationConfig[]> | undefined {
    return this.store.get(this._tenantKey(context));
  }

  private _getOrCreateTenantBucket(
    context: ServerCallContext
  ): Map<string, TaskPushNotificationConfig[]> {
    const key = this._tenantKey(context);
    let bucket = this.store.get(key);
    if (!bucket) {
      bucket = new Map();
      this.store.set(key, bucket);
    }
    return bucket;
  }

  async save(
    taskId: string,
    context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig
  ): Promise<void> {
    const bucket = this._getOrCreateTenantBucket(context);
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
    const configs = this._getTenantBucket(context)?.get(taskId);
    return configs || [];
  }

  async delete(taskId: string, context: ServerCallContext, configId?: string): Promise<void> {
    // If no configId is provided, use taskId as the configId (backward compatibility)
    if (configId === undefined) {
      configId = taskId;
    }

    const bucket = this._getTenantBucket(context);
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

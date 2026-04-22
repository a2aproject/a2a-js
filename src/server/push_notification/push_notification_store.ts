import { RequestMalformedError } from '../../errors.js';
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
 * Uses `context.tenant` to build composite storage keys, preventing cross-tenant access.
 */
export class InMemoryPushNotificationStore implements PushNotificationStore {
  private store: Map<string, TaskPushNotificationConfig[]> = new Map();

  /**
   * Builds a composite storage key from tenant and task ID.
   */
  private _storageKey(taskId: string, context: ServerCallContext): string {
    if (context.tenant) {
      return `${context.tenant}:${taskId}`;
    }
    if (taskId && taskId.includes(':')) {
      throw new RequestMalformedError('Task ID cannot contain ":" character for global tasks.');
    }
    return taskId;
  }

  async save(
    taskId: string,
    context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig
  ): Promise<void> {
    const key = this._storageKey(taskId, context);
    const configs = this.store.get(key) || [];

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
    this.store.set(key, configs);
  }

  async load(taskId: string, context: ServerCallContext): Promise<TaskPushNotificationConfig[]> {
    const key = this._storageKey(taskId, context);
    const configs = this.store.get(key);
    return configs || [];
  }

  async delete(taskId: string, context: ServerCallContext, configId?: string): Promise<void> {
    // If no configId is provided, use taskId as the configId (backward compatibility)
    if (configId === undefined) {
      configId = taskId;
    }

    const key = this._storageKey(taskId, context);
    const configs = this.store.get(key);
    if (!configs) {
      return;
    }

    const configIndex = configs.findIndex((config) => config.id === configId);
    if (configIndex !== -1) {
      configs.splice(configIndex, 1);
    }

    if (configs.length === 0) {
      this.store.delete(key);
    } else {
      this.store.set(key, configs);
    }
  }
}

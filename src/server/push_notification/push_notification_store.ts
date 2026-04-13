import { TaskPushNotificationConfig } from '../../index.js';
import { ServerCallContext } from '../context.js';

export interface PushNotificationStore {
  save(
    taskId: string,
    context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig
  ): Promise<void>;
  load(taskId: string, context: ServerCallContext): Promise<TaskPushNotificationConfig[]>;
  delete(taskId: string, context: ServerCallContext, configId?: string): Promise<void>;
}

export class InMemoryPushNotificationStore implements PushNotificationStore {
  private store: Map<string, TaskPushNotificationConfig[]> = new Map();

  async save(
    taskId: string,
    _context: ServerCallContext,
    pushNotificationConfig: TaskPushNotificationConfig
  ): Promise<void> {
    const configs = this.store.get(taskId) || [];

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
    this.store.set(taskId, configs);
  }

  async load(taskId: string, _context: ServerCallContext): Promise<TaskPushNotificationConfig[]> {
    const configs = this.store.get(taskId);
    return configs || [];
  }

  async delete(taskId: string, _context: ServerCallContext, configId?: string): Promise<void> {
    // If no configId is provided, use taskId as the configId (backward compatibility)
    if (configId === undefined) {
      configId = taskId;
    }

    const configs = this.store.get(taskId);
    if (!configs) {
      return;
    }

    const configIndex = configs.findIndex((config) => config.id === configId);
    if (configIndex !== -1) {
      configs.splice(configIndex, 1);
    }

    if (configs.length === 0) {
      this.store.delete(taskId);
    } else {
      this.store.set(taskId, configs);
    }
  }
}

import { DefaultExecutionEventBus, ExecutionEventBus } from './execution_event_bus.js';

export interface ExecutionEventBusManager {
  createOrGetByTaskId(taskId: string): ExecutionEventBus;
  getByTaskId(taskId: string): ExecutionEventBus | undefined;
  cleanupByTaskId(taskId: string): void;
}

export class DefaultExecutionEventBusManager implements ExecutionEventBusManager {
  private taskIdToBus: Map<string, ExecutionEventBus> = new Map();

  /**
   * Creates or retrieves an existing ExecutionEventBus based on the taskId.
   * @param taskId The ID of the task.
   * @returns An instance of ExecutionEventBus.
   */
  public createOrGetByTaskId(taskId: string): ExecutionEventBus {
    if (!this.taskIdToBus.has(taskId)) {
      this.taskIdToBus.set(taskId, new DefaultExecutionEventBus());
    }
    return this.taskIdToBus.get(taskId)!;
  }

  /**
   * Retrieves an existing ExecutionEventBus based on the taskId.
   * @param taskId The ID of the task.
   * @returns An instance of ExecutionEventBus or undefined if not found.
   */
  public getByTaskId(taskId: string): ExecutionEventBus | undefined {
    return this.taskIdToBus.get(taskId);
  }

  /**
   * Removes the event bus for a given taskId.
   * This should be called when an execution flow is complete to free resources.
   * @param taskId The ID of the task.
   */
  public cleanupByTaskId(taskId: string): void {
    const bus = this.taskIdToBus.get(taskId);
    if (bus) {
      bus.removeAllListeners();
    }
    this.taskIdToBus.delete(taskId);
  }
}

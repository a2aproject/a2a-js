import { DefaultExecutionEventBus, ExecutionEventBus } from './execution_event_bus.js';

export interface ExecutionEventBusManager {
  createOrGetByTaskId(taskId: string): ExecutionEventBus;
  getByTaskId(taskId: string): ExecutionEventBus | undefined;
  cleanupByTaskId(taskId: string): void;
}

export class DefaultExecutionEventBusManager implements ExecutionEventBusManager {
  private taskIdToBus: Map<string, ExecutionEventBus> = new Map();

  public createOrGetByTaskId(taskId: string): ExecutionEventBus {
    if (!this.taskIdToBus.has(taskId)) {
      this.taskIdToBus.set(taskId, new DefaultExecutionEventBus());
    }
    return this.taskIdToBus.get(taskId)!;
  }

  public getByTaskId(taskId: string): ExecutionEventBus | undefined {
    return this.taskIdToBus.get(taskId);
  }

  /** Removes the bus for the task. Call when the execution flow ends. */
  public cleanupByTaskId(taskId: string): void {
    const bus = this.taskIdToBus.get(taskId);
    if (bus) {
      bus.removeAllListeners();
    }
    this.taskIdToBus.delete(taskId);
  }
}

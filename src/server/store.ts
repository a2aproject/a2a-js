import { Task, TaskStatus } from '../types.js';
import { ServerCallContext } from './context.js';

/**
 * Simplified interface for task storage providers.
 * Stores and retrieves the task.
 */
export interface TaskStore {
  /**
   * Saves a task.
   * Overwrites existing data if the task ID exists.
   * @param task The task to save.
   * @param context The context of the current call.
   * @returns A promise resolving when the save operation is complete.
   */
  save(task: Task, context?: ServerCallContext): Promise<void>;

  /**
   * Loads a task by task ID.
   * @param taskId The ID of the task to load.
   * @param context The context of the current call.
   * @returns A promise resolving to an object containing the Task, or undefined if not found.
   */
  load(taskId: string, context?: ServerCallContext): Promise<Task | undefined>;

  /**
   * Deletes a task by task ID.
   * @param taskId The ID of the task to delete.
   * @returns A promise resolving when the delete operation is complete.
   */
  delete(taskId: string): Promise<void>;

  /**
   * Lists tasks.
   * @param page The page number will send all tasks if not provided.
   * @param pageSize The page size will send all tasks if not provided.
   * @param status The list of statuses to filter tasks by.
   * @param metadataSearch To filter tasks by metadata keys and values.
   * @returns A promise resolving to an object containing the tasks.
   */
  list(
    page?: string,
    pageSize?: string,
    status?: TaskStatus['state'][],
    metadataSearch?: Record<string, unknown>
  ): Promise<{ result: Task[]; totalNumberOfTasks: number }>;
}

// ========================
// InMemoryTaskStore
// ========================

// Use Task directly for storage
export class InMemoryTaskStore implements TaskStore {
  private store: Map<string, Task> = new Map();

  async load(taskId: string): Promise<Task | undefined> {
    const entry = this.store.get(taskId);
    // Return copies to prevent external mutation
    return entry ? { ...entry } : undefined;
  }

  async save(task: Task): Promise<void> {
    // Store copies to prevent internal mutation if caller reuses objects
    this.store.set(task.id, { ...task });
  }

  async delete(taskId: string): Promise<void> {
    this.store.delete(taskId);
  }

  async list(
    page?: string,
    pageSize?: string,
    status?: TaskStatus['state'][],
    metadataSearch?: Record<string, unknown>
  ): Promise<{ result: Task[]; totalNumberOfTasks: number }> {
    const tasks = Array.from(this.store.values());
    const filteredTasks = !status
      ? tasks
      : tasks.filter((task) => status?.includes(task.status.state));
    const filteredTasksByMetadata = !metadataSearch
      ? filteredTasks
      : filteredTasks.filter((task) =>
          Object.entries(metadataSearch).every(
            ([key, value]) => task.metadata?.[key] === (value as unknown)
          )
        );
    const paginatedTasks =
      !page || !pageSize
        ? filteredTasksByMetadata
        : filteredTasksByMetadata.slice(
            (Number(page) - 1) * Number(pageSize),
            Number(page) * Number(pageSize)
          );
    const totalNumberOfTasks = filteredTasksByMetadata.length;
    return {
      result: paginatedTasks,
      totalNumberOfTasks,
    };
  }
}

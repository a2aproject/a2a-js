import { Task, ListTasksRequest, ListTasksResponse } from '../index.js';
import { ServerCallContext } from './context.js';
import { DEFAULT_PAGE_SIZE } from '../constants.js';

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
   * Lists tasks with filtering and pagination.
   * @param params Filtering and pagination parameters.
   * @param context The context of the current call.
   */
  list(params: ListTasksRequest, context?: ServerCallContext): Promise<ListTasksResponse>;
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

  async list(params: ListTasksRequest): Promise<ListTasksResponse> {
    const {
      contextId,
      status,
      pageSize = DEFAULT_PAGE_SIZE,
      pageToken,
      historyLength = 0,
      statusTimestampAfter,
      includeArtifacts = false,
    } = params;

    let tasks = Array.from(this.store.values());

    // Filter by contextId
    if (contextId) {
      tasks = tasks.filter((task) => task.contextId === contextId);
    }

    // Filter by status
    if (status) {
      tasks = tasks.filter((task) => task.status?.state === status);
    }

    // Filter by timestamp after
    if (statusTimestampAfter) {
      const filterTime = new Date(statusTimestampAfter).getTime();
      tasks = tasks.filter(
        (task) => task.status?.timestamp && new Date(task.status.timestamp).getTime() > filterTime
      );
    }

    // Sort by timestamp descending
    tasks.sort((taskA, taskB) => {
      const timeA = taskA.status?.timestamp ? new Date(taskA.status.timestamp).getTime() : 0;
      const timeB = taskB.status?.timestamp ? new Date(taskB.status.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    // Pagination cursor
    let cursorTime = Infinity;
    if (pageToken) {
      try {
        cursorTime = parseInt(Buffer.from(pageToken, 'base64').toString('utf-8'), 10);
      } catch (e) {
        throw new Error('Token is not a valid base64-encoded cursor.', { cause: e });
      }
    }

    // Apply cursor
    tasks = tasks.filter((task) => {
      const taskTime = task.status?.timestamp ? new Date(task.status.timestamp).getTime() : 0;
      return taskTime < cursorTime;
    });

    const totalSize = tasks.length;

    const hasMore = tasks.length > pageSize;
    const paginatedTasks = tasks.slice(0, pageSize);

    // Map tasks to response format
    const resultTasks = paginatedTasks.map((task) => {
      const taskCopy = { ...task };
      if (!includeArtifacts) {
        taskCopy.artifacts = [];
      }
      if (historyLength > 0 && taskCopy.history) {
        taskCopy.history = taskCopy.history.slice(-historyLength);
      } else {
        taskCopy.history = [];
      }
      return taskCopy;
    });

    let nextPageToken = '';
    if (hasMore && resultTasks.length > 0) {
      const lastTask = resultTasks[resultTasks.length - 1];
      const lastTime = lastTask.status?.timestamp
        ? new Date(lastTask.status.timestamp).getTime()
        : 0;
      nextPageToken = Buffer.from(lastTime.toString()).toString('base64');
    }

    return {
      tasks: resultTasks,
      nextPageToken,
      pageSize,
      totalSize,
    };
  }
}

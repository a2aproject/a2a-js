import fs, { lutimes } from "fs/promises";
import path from "path";
import {ListTasksParams, ListTasksResult, Task} from "../types.js";
import { A2AError } from "./error.js";
import {
  getCurrentTimestamp,
  isArtifactUpdate,
  isTaskStatusUpdate,
} from "./utils.js";
import { DEFAULT_PAGE_SIZE } from "../constants.js";

/**
 * Simplified interface for task storage providers.
 * Stores and retrieves the task.
 */
export interface TaskStore {
  /**
   * Saves a task.
   * Overwrites existing data if the task ID exists.
   * @param data An object containing the task.
   * @returns A promise resolving when the save operation is complete.
   */
  save(task: Task): Promise<void>;

  /**
   * Loads a task by task ID.
   * @param taskId The ID of the task to load.
   * @returns A promise resolving to an object containing the Task, or undefined if not found.
   */
  load(taskId: string): Promise<Task | undefined>;

  /**
   * Retrieves a paginated and filtered list of tasks from the store.
   *
   * @param params An object containing criteria for filtering, sorting, and pagination.
   * @returns A promise resolving to a `ListTasksResult` object, which includes the filtered and paginated tasks,
   *   the total number of tasks matching the criteria, the actual page size, and a token for the next page (if available).
   */
  list(params: ListTasksParams): Promise<ListTasksResult>;
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
    return entry ? {...entry} : undefined;
  }

  async save(task: Task): Promise<void> {
    // Store copies to prevent internal mutation if caller reuses objects
    this.store.set(task.id, {...task});
  }

  async list(params: ListTasksParams): Promise<ListTasksResult> {
    // Returns the list of saved tasks
    const lastUpdatedAfterDate = params.lastUpdatedAfter ? new Date(params.lastUpdatedAfter) : undefined;
    const pageTokenDate = params.pageToken ? new Date(Buffer.from(params.pageToken, 'base64').toString('utf-8')) : undefined;
    const filteredTasks = Array.from(this.store.values())
      // Apply filters
      .filter(task => !params.contextId || task.contextId === params.contextId)
      .filter(task => !params.status || task.status.state === params.status)
      .filter(task => {
          if (!params.lastUpdatedAfter) return true;
          if (!task.status.timestamp) return false; // Tasks without timestamp don't match 'lastUpdatedAfter'
          return new Date(task.status.timestamp) > lastUpdatedAfterDate;
      })
      .filter(task => {
          if (!params.pageToken) return true;
          if (!task.status.timestamp) return false; // Tasks without timestamp don't match 'pageToken'
          // pageToken is a timestamp, so we want tasks older than the pageToken
          return new Date(task.status.timestamp) < pageTokenDate;
      })

    // Sort by timestamp in descending order (most recently updated tasks first)
    filteredTasks.sort((t1, t2) => {
      const ts1 = t1.status.timestamp ? new Date(t1.status.timestamp).getTime() : 0;
      const ts2 = t2.status.timestamp ? new Date(t2.status.timestamp).getTime() : 0;
      return ts2 - ts1;
    });

    // Apply pagination
    let paginatedTasks = filteredTasks.slice(0, params.pageSize ?? DEFAULT_PAGE_SIZE);
    let nextPageToken = '';
    if (filteredTasks.length > paginatedTasks.length) {
        const lastTaskOnPage = paginatedTasks[paginatedTasks.length - 1];
        if (lastTaskOnPage && lastTaskOnPage.status.timestamp) {
            nextPageToken = lastTaskOnPage.status.timestamp;
        }
    }

    paginatedTasks = paginatedTasks.map(task => {
      // Make a copy of the tasks to avoid modification of original stored object
      const newTask = {
        ...task,
        history: task.history ? [...task.history] : undefined,
        artifacts: task.artifacts ? [...task.artifacts] : undefined,
      };

      const historyLength = params.historyLength ?? 0;
      newTask.history = historyLength > 0 ? newTask.history?.slice(-historyLength) : [];

      if (!params.includeArtifacts && newTask.artifacts){
          newTask.artifacts = [];
      }
      return newTask;
    })

    return {
        tasks: paginatedTasks,
        totalSize: filteredTasks.length,
        pageSize: paginatedTasks.length,
        nextPageToken: Buffer.from(nextPageToken).toString('base64'), // Convert to base64
    };
  }
  
}

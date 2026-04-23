import { Task, ListTasksRequest, ListTasksResponse } from '../index.js';
import { ServerCallContext } from './context.js';
import { DEFAULT_PAGE_SIZE } from '../constants.js';
import { RequestMalformedError } from '../errors.js';

/**
 * Simplified interface for task storage providers.
 * Stores and retrieves the task.
 *
 * Implementations SHOULD use `context.tenant` (when present) to scope data access.
 * Per spec Section 13.1, servers MUST ensure appropriate scope limitation based on
 * the authenticated caller's authorization boundaries, which includes tenant isolation
 * in multi-tenant deployments.
 */
export interface TaskStore {
  /**
   * Saves a task.
   * Overwrites existing data if the task ID exists.
   * @param task The task to save.
   * @param context The context of the current call. Use `context.tenant` for tenant-scoped storage.
   * @returns A promise resolving when the save operation is complete.
   */
  save(task: Task, context: ServerCallContext): Promise<void>;

  /**
   * Loads a task by task ID.
   * @param taskId The ID of the task to load.
   * @param context The context of the current call. Use `context.tenant` for tenant-scoped lookups.
   * @returns A promise resolving to an object containing the Task, or undefined if not found.
   */
  load(taskId: string, context: ServerCallContext): Promise<Task | undefined>;

  /**
   * Lists tasks with filtering and pagination.
   * @param params Filtering and pagination parameters.
   * @param context The context of the current call. Use `context.tenant` for tenant-scoped listing.
   */
  list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse>;
}

// ========================
// InMemoryTaskStore
// ========================
//
// InMemoryTaskStore provides tenant-scoped data isolation using `context.tenant`.
// A nested Map structure (tenant -> taskId -> Task) is used so that tenant scoping
// is structural rather than key-convention based, imposing no restrictions on task ID format.

export class InMemoryTaskStore implements TaskStore {
  // Outer map: tenant key ('' for global/no-tenant) -> inner map of taskId -> Task
  private store: Map<string, Map<string, Task>> = new Map();

  private _tenantKey(context: ServerCallContext): string {
    return context.tenant ?? '';
  }

  private _getTenantBucket(context: ServerCallContext): Map<string, Task> | undefined {
    return this.store.get(this._tenantKey(context));
  }

  private _getOrCreateTenantBucket(context: ServerCallContext): Map<string, Task> {
    const key = this._tenantKey(context);
    let bucket = this.store.get(key);
    if (!bucket) {
      bucket = new Map();
      this.store.set(key, bucket);
    }
    return bucket;
  }

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    const entry = this._getTenantBucket(context)?.get(taskId);
    // Return copies to prevent external mutation
    return entry ? { ...entry } : undefined;
  }

  async save(task: Task, context: ServerCallContext): Promise<void> {
    // Store copies to prevent internal mutation if caller reuses objects
    this._getOrCreateTenantBucket(context).set(task.id, { ...task });
  }

  async list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse> {
    const {
      contextId,
      status,
      pageSize = DEFAULT_PAGE_SIZE,
      pageToken,
      historyLength = 0,
      statusTimestampAfter,
      includeArtifacts = false,
    } = params;

    const bucket = this._getTenantBucket(context);
    let tasks = bucket ? Array.from(bucket.values()) : [];

    // Filter by contextId
    if (contextId) {
      tasks = tasks.filter((task) => task.contextId === contextId);
    }

    // Filter by status
    if (status !== undefined) {
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
      const timeA = taskA.status?.timestamp || '';
      const timeB = taskB.status?.timestamp || '';
      if (timeB !== timeA) {
        return timeB.localeCompare(timeA);
      }
      return taskB.id.localeCompare(taskA.id);
    });

    const totalSize = tasks.length;

    // Pagination cursor
    if (pageToken) {
      try {
        const decoded = Buffer.from(pageToken, 'base64').toString('utf-8');
        const [cursorTimestamp, ...idParts] = decoded.split('|');
        if (idParts.length === 0) {
          throw new RequestMalformedError('Invalid page token format.');
        }
        const cursorId = idParts.join('|');

        const cursorIndex = tasks.findIndex(
          (task) => (task.status?.timestamp || '') === cursorTimestamp && task.id === cursorId
        );

        if (cursorIndex !== -1) {
          tasks = tasks.slice(cursorIndex + 1);
        } else {
          // This case can happen if the cursor task was deleted.
          tasks = [];
        }
      } catch (e) {
        if (e instanceof RequestMalformedError) throw e;
        throw new RequestMalformedError('Token is not a valid base64-encoded cursor.');
      }
    }

    const paginatedTasks = tasks.slice(0, pageSize);

    // Map tasks to response format
    const resultTasks = paginatedTasks.map((task) => {
      const taskCopy = JSON.parse(JSON.stringify(task));
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
    if (paginatedTasks.length > 0 && tasks.length > paginatedTasks.length) {
      const lastTask = paginatedTasks[paginatedTasks.length - 1];
      const lastTime = lastTask.status?.timestamp || '';
      nextPageToken = Buffer.from(`${lastTime}|${lastTask.id}`).toString('base64');
    }

    return {
      tasks: resultTasks,
      nextPageToken,
      pageSize,
      totalSize,
    };
  }
}

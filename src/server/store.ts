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
// Tasks are stored with a composite key of `{tenant}:{taskId}` when a tenant is present.
// When no tenant is specified, tasks are stored under the taskId alone (global scope).

export class InMemoryTaskStore implements TaskStore {
  private store: Map<string, Task> = new Map();

  /**
   * Builds a composite storage key from tenant and task ID.
   * When tenant is present, the key is `{tenant}:{taskId}` to provide tenant isolation.
   * When tenant is absent, the key is the taskId alone (global scope).
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

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    const entry = this.store.get(this._storageKey(taskId, context));
    // Return copies to prevent external mutation
    return entry ? { ...entry } : undefined;
  }

  async save(task: Task, context: ServerCallContext): Promise<void> {
    // Store copies to prevent internal mutation if caller reuses objects
    this.store.set(this._storageKey(task.id, context), { ...task });
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

    let tasks = Array.from(this.store.entries())
      // Filter by tenant: only return tasks whose storage key belongs to the current tenant scope
      .filter(([key]) => {
        if (context.tenant) {
          return key.startsWith(`${context.tenant}:`);
        }
        // When no tenant is specified, only return global-scope tasks (no ':' prefix from tenanting)
        return !key.includes(':') || this._isGlobalKey(key);
      })
      .map(([, task]) => task);

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

  /**
   * Checks if a key that contains ':' is actually a global-scope key
   * (i.e., the task ID itself contains ':'). This is determined by checking
   * whether the key exists in the store as a task whose ID matches the full key.
   */
  private _isGlobalKey(key: string): boolean {
    const task = this.store.get(key);
    return task !== undefined && task.id === key;
  }
}

import { Task, ListTasksRequest, ListTasksResponse } from '../index.js';
import { ServerCallContext } from './context.js';
import { DEFAULT_PAGE_SIZE } from '../constants.js';
import { RequestMalformedError } from '../errors.js';
import { OwnerResolver, resolveUserScope } from './owner_resolver.js';
import { ScopedStore } from './utils.js';

/**
 * Simplified interface for task storage providers.
 * Stores and retrieves the task.
 *
 * Implementations SHOULD use `context.tenant` (when present) and the authenticated
 * caller's identity to scope data access. Per spec §13.1, servers MUST ensure
 * appropriate scope limitation based on the authenticated caller's authorization
 * boundaries. This includes both tenant isolation in multi-tenant deployments and
 * user/owner-level resource scoping so that each authenticated client can only
 * access its own tasks.
 *
 * The built-in {@link InMemoryTaskStore} uses an {@link OwnerResolver} (defaulting
 * to {@link resolveUserScope}) to derive the owner from `context.user`.
 */
export interface TaskStore {
  /**
   * Saves a task.
   * Overwrites existing data if the task ID exists.
   * @param task The task to save.
   * @param context The context of the current call.
   *   Use `context.tenant` for tenant-scoped storage and `context.user` for owner scoping.
   * @returns A promise resolving when the save operation is complete.
   */
  save(task: Task, context: ServerCallContext): Promise<void>;

  /**
   * Loads a task by task ID.
   * Returns `undefined` if the task does not exist or is not accessible to the caller.
   * @param taskId The ID of the task to load.
   * @param context The context of the current call.
   *   Use `context.tenant` for tenant-scoped lookups and `context.user` for owner scoping.
   * @returns A promise resolving to the Task, or undefined if not found/not accessible.
   */
  load(taskId: string, context: ServerCallContext): Promise<Task | undefined>;

  /**
   * Lists tasks with filtering and pagination.
   * Per spec §3.1.4, the operation MUST return only tasks visible to the authenticated client.
   * @param params Filtering and pagination parameters.
   * @param context The context of the current call.
   *   Use `context.tenant` for tenant-scoped listing and `context.user` for owner scoping.
   */
  list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse>;
}

// ========================
// InMemoryTaskStore
// ========================
//
// InMemoryTaskStore provides tenant- and owner-scoped data isolation.
// A triple-nested Map structure (tenant -> owner -> taskId -> Task) is used so that
// both tenant and owner scoping are structural rather than key-convention based,
// imposing no restrictions on task ID format.
//
// Per spec §13.1, servers MUST ensure appropriate scope limitation based on the
// authenticated caller's authorization boundaries. This store resolves the owner
// via an OwnerResolver (defaulting to resolveUserScope which uses context.user.userName).

export class InMemoryTaskStore implements TaskStore {
  private readonly _scopedStore: ScopedStore<Task>;

  constructor(ownerResolver: OwnerResolver = resolveUserScope) {
    this._scopedStore = new ScopedStore<Task>(ownerResolver);
  }

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    const entry = this._scopedStore.getBucket(context)?.get(taskId);
    // Return deep copies to prevent external mutation
    return entry ? structuredClone(entry) : undefined;
  }

  async save(task: Task, context: ServerCallContext): Promise<void> {
    // Store deep copies to prevent internal mutation if caller reuses objects
    this._scopedStore.getOrCreateBucket(context).set(task.id, structuredClone(task));
  }

  async list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse> {
    const {
      contextId,
      status,
      pageSize = DEFAULT_PAGE_SIZE,
      pageToken,
      statusTimestampAfter,
      includeArtifacts = false,
    } = params;

    const bucket = this._scopedStore.getBucket(context);
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
      const taskCopy = structuredClone(task);
      if (!includeArtifacts) {
        taskCopy.artifacts = [];
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

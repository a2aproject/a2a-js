import { Task, ListTasksRequest, ListTasksResponse } from '../index.js';
import { ServerCallContext } from './context.js';
import { DEFAULT_PAGE_SIZE } from '../constants.js';
import { RequestMalformedError } from '../errors.js';
import { OwnerResolver, resolveUserScope } from './owner_resolver.js';
import { ScopedStore } from './utils.js';

/**
 * Interface for task storage providers. Implementations SHOULD use
 * `context.tenant` (when present) and the authenticated caller's identity
 * to scope data access so that each authenticated client only sees its
 * own tasks.
 *
 * The built-in {@link InMemoryTaskStore} uses an {@link OwnerResolver}
 * (defaulting to {@link resolveUserScope}) to derive the owner from
 * `context.user`.
 */
export interface TaskStore {
  /**
   * Saves a task, overwriting any existing entry with the same ID.
   * @param task The task to save.
   * @param context The context of the current call. Use `context.tenant`
   *   for tenant-scoped storage and `context.user` for owner scoping.
   */
  save(task: Task, context: ServerCallContext): Promise<void>;

  /**
   * Loads a task by ID, or `undefined` if not found / not accessible.
   * @param taskId The ID of the task to load.
   * @param context The context of the current call. Use `context.tenant`
   *   for tenant-scoped lookups and `context.user` for owner scoping.
   */
  load(taskId: string, context: ServerCallContext): Promise<Task | undefined>;

  /**
   * Lists tasks visible to the authenticated caller, with filtering and pagination.
   * @param params Filtering and pagination parameters.
   * @param context The context of the current call. Use `context.tenant`
   *   for tenant-scoped listing and `context.user` for owner scoping.
   */
  list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse>;
}

/**
 * In-memory {@link TaskStore} backed by a triple-nested Map
 * (tenant -> owner -> taskId -> Task). Owner identity comes from an
 * {@link OwnerResolver} (defaulting to {@link resolveUserScope}).
 */
export class InMemoryTaskStore implements TaskStore {
  private readonly _scopedStore: ScopedStore<Task>;

  constructor(ownerResolver: OwnerResolver = resolveUserScope) {
    this._scopedStore = new ScopedStore<Task>(ownerResolver);
  }

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    const entry = this._scopedStore.getBucket(context)?.get(taskId);
    // Return deep copies so callers can't mutate our internal state.
    return entry ? structuredClone(entry) : undefined;
  }

  async save(task: Task, context: ServerCallContext): Promise<void> {
    // Store deep copies so caller-side mutation can't drift our state.
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

    if (contextId) {
      tasks = tasks.filter((task) => task.contextId === contextId);
    }

    if (status !== undefined) {
      tasks = tasks.filter((task) => task.status?.state === status);
    }

    if (statusTimestampAfter) {
      const filterTime = new Date(statusTimestampAfter).getTime();
      tasks = tasks.filter(
        (task) => task.status?.timestamp && new Date(task.status.timestamp).getTime() > filterTime
      );
    }

    // Sort by timestamp descending; break ties by id descending.
    tasks.sort((taskA, taskB) => {
      const timeA = taskA.status?.timestamp || '';
      const timeB = taskB.status?.timestamp || '';
      if (timeB !== timeA) {
        return timeB.localeCompare(timeA);
      }
      return taskB.id.localeCompare(taskA.id);
    });

    const totalSize = tasks.length;

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
          // The cursor task may have been deleted between calls.
          tasks = [];
        }
      } catch (e) {
        if (e instanceof RequestMalformedError) throw e;
        throw new RequestMalformedError('Token is not a valid base64-encoded cursor.');
      }
    }

    const paginatedTasks = tasks.slice(0, pageSize);

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

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTaskStore } from '../../src/server/store.js';
import { ServerCallContext } from '../../src/server/context.js';
import { ListTasksRequest, Task, TaskState } from '../../src/index.js';

function createContext(): ServerCallContext {
  return new ServerCallContext();
}

function createTask(id: string, timestamp: string): Task {
  return {
    id,
    contextId: 'ctx-list',
    status: {
      state: TaskState.TASK_STATE_WORKING,
      timestamp,
      message: undefined,
    },
    artifacts: [],
    history: [],
    metadata: {},
  };
}

function listParams(overrides: Partial<ListTasksRequest> = {}): ListTasksRequest {
  return {
    tenant: '',
    contextId: '',
    status: TaskState.TASK_STATE_UNSPECIFIED,
    pageSize: 1,
    pageToken: '',
    historyLength: 0,
    statusTimestampAfter: undefined,
    includeArtifacts: false,
    ...overrides,
  };
}

async function seedStore(store: InMemoryTaskStore, tasks: Task[], context: ServerCallContext) {
  for (const task of tasks) {
    await store.save(task, context);
  }
}

describe('InMemoryTaskStore.list() pagination', () => {
  let store: InMemoryTaskStore;
  let context: ServerCallContext;
  const newest = createTask('task-a', '2024-03-03T00:00:00.000Z');
  const middle = createTask('task-b', '2024-03-02T00:00:00.000Z');
  const oldest = createTask('task-c', '2024-03-01T00:00:00.000Z');

  beforeEach(() => {
    store = new InMemoryTaskStore();
    context = createContext();
  });

  it('resumes after the cursor when that task is still present', async () => {
    await seedStore(store, [newest, middle, oldest], context);

    const firstPage = await store.list(listParams(), context);
    expect(firstPage.tasks.map((task) => task.id)).toEqual(['task-a']);
    expect(firstPage.nextPageToken).not.toBe('');
    expect(firstPage.totalSize).toBe(3);

    const secondPage = await store.list(
      listParams({ pageToken: firstPage.nextPageToken }),
      context
    );
    expect(secondPage.tasks.map((task) => task.id)).toEqual(['task-b']);
    expect(secondPage.nextPageToken).not.toBe('');
    expect(secondPage.totalSize).toBe(3);

    const thirdPage = await store.list(
      listParams({ pageToken: secondPage.nextPageToken }),
      context
    );
    expect(thirdPage.tasks.map((task) => task.id)).toEqual(['task-c']);
    expect(thirdPage.nextPageToken).toBe('');
    expect(thirdPage.totalSize).toBe(3);
  });

  it('returns the next tasks when the cursor task has been deleted', async () => {
    await seedStore(store, [newest, middle, oldest], context);
    const firstPage = await store.list(listParams(), context);
    expect(firstPage.tasks[0].id).toBe('task-a');

    const remaining = new InMemoryTaskStore();
    await seedStore(remaining, [middle, oldest], context);

    const nextPage = await remaining.list(
      listParams({ pageToken: firstPage.nextPageToken }),
      context
    );
    expect(nextPage.tasks.map((task) => task.id)).toEqual(['task-b']);
    expect(nextPage.nextPageToken).not.toBe('');
    expect(nextPage.totalSize).toBe(2);

    const lastPage = await remaining.list(
      listParams({ pageToken: nextPage.nextPageToken }),
      context
    );
    expect(lastPage.tasks.map((task) => task.id)).toEqual(['task-c']);
    expect(lastPage.nextPageToken).toBe('');
  });

  it('skips a deleted mid-list cursor and does not restart from the newest task', async () => {
    await seedStore(store, [newest, middle, oldest], context);
    const firstPage = await store.list(listParams(), context);
    const secondPage = await store.list(
      listParams({ pageToken: firstPage.nextPageToken }),
      context
    );
    expect(secondPage.tasks.map((task) => task.id)).toEqual(['task-b']);

    const remaining = new InMemoryTaskStore();
    await seedStore(remaining, [newest, oldest], context);

    const nextPage = await remaining.list(
      listParams({ pageToken: secondPage.nextPageToken }),
      context
    );
    expect(nextPage.tasks.map((task) => task.id)).toEqual(['task-c']);
    expect(nextPage.nextPageToken).toBe('');
    expect(nextPage.totalSize).toBe(2);
  });

  it('returns an empty page when the deleted cursor was the last remaining task', async () => {
    await seedStore(store, [newest, middle, oldest], context);
    const firstPage = await store.list(listParams({ pageSize: 2 }), context);
    expect(firstPage.tasks.map((task) => task.id)).toEqual(['task-a', 'task-b']);
    expect(firstPage.nextPageToken).not.toBe('');

    const afterLastPageGone = new InMemoryTaskStore();
    await seedStore(afterLastPageGone, [newest], context);

    const nextPage = await afterLastPageGone.list(
      listParams({ pageSize: 2, pageToken: firstPage.nextPageToken }),
      context
    );
    expect(nextPage.tasks).toEqual([]);
    expect(nextPage.nextPageToken).toBe('');
    expect(nextPage.totalSize).toBe(1);
  });

  it('round-trips a task id that contains a pipe character', async () => {
    const timestamp = '2024-03-02T00:00:00.000Z';
    // 'z|task' > 'z-task' > 'z' in id-desc order, so a decode that keeps only
    // the first '|' segment ('z') would skip 'z-task' on the next page.
    const piped = createTask('z|task', timestamp);
    const later = createTask('z-task', timestamp);
    await seedStore(store, [piped, later], context);

    const firstPage = await store.list(listParams(), context);
    expect(firstPage.tasks.map((task) => task.id)).toEqual(['z|task']);
    expect(firstPage.nextPageToken).not.toBe('');

    const secondPage = await store.list(
      listParams({ pageToken: firstPage.nextPageToken }),
      context
    );
    expect(secondPage.tasks.map((task) => task.id)).toEqual(['z-task']);
    expect(secondPage.nextPageToken).toBe('');
  });

  it('resumes after a deleted cursor when ids share a timestamp and contain |', async () => {
    const timestamp = '2024-03-02T00:00:00.000Z';
    const first = createTask('z|task', timestamp);
    const second = createTask('z-task', timestamp);
    const third = createTask('a-task', timestamp);
    await seedStore(store, [first, second, third], context);

    const firstPage = await store.list(listParams(), context);
    expect(firstPage.tasks.map((task) => task.id)).toEqual(['z|task']);

    const remaining = new InMemoryTaskStore();
    await seedStore(remaining, [second, third], context);

    const nextPage = await remaining.list(
      listParams({ pageToken: firstPage.nextPageToken }),
      context
    );
    expect(nextPage.tasks.map((task) => task.id)).toEqual(['z-task']);
    expect(nextPage.nextPageToken).not.toBe('');
    expect(nextPage.totalSize).toBe(2);
  });
});

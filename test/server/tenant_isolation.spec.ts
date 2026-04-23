import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTaskStore } from '../../src/server/store.js';
import { InMemoryPushNotificationStore } from '../../src/server/push_notification/push_notification_store.js';
import { ServerCallContext } from '../../src/server/context.js';
import { Task, TaskState, TaskPushNotificationConfig } from '../../src/index.js';

function createContext(tenant?: string): ServerCallContext {
  return new ServerCallContext(undefined, undefined, tenant);
}

function createTask(id: string, contextId: string = 'ctx-1'): Task {
  return {
    id,
    contextId,
    status: {
      state: TaskState.TASK_STATE_COMPLETED,
      timestamp: new Date().toISOString(),
      message: undefined,
    },
    artifacts: [],
    history: [],
    metadata: {},
  };
}

describe('InMemoryTaskStore tenant isolation', () => {
  let store: InMemoryTaskStore;

  beforeEach(() => {
    store = new InMemoryTaskStore();
  });

  it('should save and load a task without tenant (global scope)', async () => {
    const ctx = createContext();
    const task = createTask('task-1');
    await store.save(task, ctx);

    const loaded = await store.load('task-1', ctx);
    expect(loaded).toBeDefined();
    expect(loaded!.id).to.equal('task-1');
  });

  it('should save and load a task with tenant', async () => {
    const ctx = createContext('tenant-A');
    const task = createTask('task-1');
    await store.save(task, ctx);

    const loaded = await store.load('task-1', ctx);
    expect(loaded).toBeDefined();
    expect(loaded!.id).to.equal('task-1');
  });

  it('should isolate tasks between tenants', async () => {
    const ctxA = createContext('tenant-A');
    const ctxB = createContext('tenant-B');

    await store.save(createTask('task-1'), ctxA);

    // Tenant A can load the task
    const loadedA = await store.load('task-1', ctxA);
    expect(loadedA).toBeDefined();

    // Tenant B cannot load the same task
    const loadedB = await store.load('task-1', ctxB);
    expect(loadedB).toBeUndefined();
  });

  it('should allow same task ID in different tenants', async () => {
    const ctxA = createContext('tenant-A');
    const ctxB = createContext('tenant-B');

    const taskA = createTask('task-1', 'ctx-A');
    const taskB = createTask('task-1', 'ctx-B');

    await store.save(taskA, ctxA);
    await store.save(taskB, ctxB);

    const loadedA = await store.load('task-1', ctxA);
    const loadedB = await store.load('task-1', ctxB);

    expect(loadedA!.contextId).to.equal('ctx-A');
    expect(loadedB!.contextId).to.equal('ctx-B');
  });

  it('should list only tasks belonging to the tenant', async () => {
    const ctxA = createContext('tenant-A');
    const ctxB = createContext('tenant-B');

    await store.save(createTask('task-a1'), ctxA);
    await store.save(createTask('task-a2'), ctxA);
    await store.save(createTask('task-b1'), ctxB);

    const listA = await store.list(
      {
        tenant: 'tenant-A',
        contextId: '',
        status: undefined,
        pageSize: 10,
        pageToken: '',
        statusTimestampAfter: '',
      },
      ctxA
    );

    expect(listA.tasks).toHaveLength(2);
    expect(listA.tasks.map((t) => t.id).sort()).toEqual(['task-a1', 'task-a2']);

    const listB = await store.list(
      {
        tenant: 'tenant-B',
        contextId: '',
        status: undefined,
        pageSize: 10,
        pageToken: '',
        statusTimestampAfter: '',
      },
      ctxB
    );

    expect(listB.tasks).toHaveLength(1);
    expect(listB.tasks[0].id).to.equal('task-b1');
  });

  it('should isolate tenant-scoped tasks from global scope', async () => {
    const ctxGlobal = createContext();
    const ctxTenant = createContext('tenant-A');

    await store.save(createTask('global-task'), ctxGlobal);
    await store.save(createTask('tenant-task'), ctxTenant);

    // Global context should not see tenant tasks
    const globalList = await store.list(
      {
        tenant: '',
        contextId: '',
        status: undefined,
        pageSize: 10,
        pageToken: '',
        statusTimestampAfter: '',
      },
      ctxGlobal
    );
    expect(globalList.tasks).toHaveLength(1);
    expect(globalList.tasks[0].id).to.equal('global-task');

    // Tenant context should not see global tasks
    const tenantList = await store.list(
      {
        tenant: 'tenant-A',
        contextId: '',
        status: undefined,
        pageSize: 10,
        pageToken: '',
        statusTimestampAfter: '',
      },
      ctxTenant
    );
    expect(tenantList.tasks).toHaveLength(1);
    expect(tenantList.tasks[0].id).to.equal('tenant-task');
  });
});

describe('InMemoryPushNotificationStore tenant isolation', () => {
  let store: InMemoryPushNotificationStore;

  const createConfig = (
    id: string,
    taskId: string,
    tenant: string = ''
  ): TaskPushNotificationConfig => ({
    tenant,
    id,
    taskId,
    url: `https://notify.example.com/${id}`,
    token: 'secret',
    authentication: undefined,
  });

  beforeEach(() => {
    store = new InMemoryPushNotificationStore();
  });

  it('should isolate configs between tenants', async () => {
    const ctxA = createContext('tenant-A');
    const ctxB = createContext('tenant-B');

    await store.save('task-1', ctxA, createConfig('config-1', 'task-1', 'tenant-A'));

    // Tenant A can load the config
    const loadedA = await store.load('task-1', ctxA);
    expect(loadedA).toHaveLength(1);
    expect(loadedA[0].id).to.equal('config-1');

    // Tenant B cannot load tenant A's configs
    const loadedB = await store.load('task-1', ctxB);
    expect(loadedB).toHaveLength(0);
  });

  it('should allow same task ID configs in different tenants', async () => {
    const ctxA = createContext('tenant-A');
    const ctxB = createContext('tenant-B');

    await store.save('task-1', ctxA, createConfig('config-a', 'task-1', 'tenant-A'));
    await store.save('task-1', ctxB, createConfig('config-b', 'task-1', 'tenant-B'));

    const loadedA = await store.load('task-1', ctxA);
    const loadedB = await store.load('task-1', ctxB);

    expect(loadedA).toHaveLength(1);
    expect(loadedA[0].id).to.equal('config-a');
    expect(loadedB).toHaveLength(1);
    expect(loadedB[0].id).to.equal('config-b');
  });

  it('should delete configs only within the tenant scope', async () => {
    const ctxA = createContext('tenant-A');
    const ctxB = createContext('tenant-B');

    await store.save('task-1', ctxA, createConfig('config-1', 'task-1', 'tenant-A'));
    await store.save('task-1', ctxB, createConfig('config-1', 'task-1', 'tenant-B'));

    // Delete from tenant A
    await store.delete('task-1', ctxA, 'config-1');

    // Tenant A config is gone
    const loadedA = await store.load('task-1', ctxA);
    expect(loadedA).toHaveLength(0);

    // Tenant B config still exists
    const loadedB = await store.load('task-1', ctxB);
    expect(loadedB).toHaveLength(1);
  });
});

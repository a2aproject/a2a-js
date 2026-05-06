import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTaskStore } from '../../src/server/store.js';
import { InMemoryPushNotificationStore } from '../../src/server/push_notification/push_notification_store.js';
import { ServerCallContext } from '../../src/server/context.js';
import { resolveUserScope } from '../../src/server/owner_resolver.js';
import { Task, TaskState, TaskPushNotificationConfig, ListTasksRequest } from '../../src/index.js';
import { User } from '../../src/server/authentication/user.js';

class TestUser implements User {
  constructor(private readonly _userName: string) {}
  get isAuthenticated(): boolean {
    return true;
  }
  get userName(): string {
    return this._userName;
  }
}

function createContext(tenant?: string, user?: User): ServerCallContext {
  return new ServerCallContext({ tenant, user });
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

// ============================================================================
// Owner Isolation Tests (§13.1 resource scoping)
// ============================================================================

const listParams: ListTasksRequest = {
  tenant: '',
  contextId: '',
  status: undefined,
  pageSize: 100,
  pageToken: '',
  statusTimestampAfter: '',
};

describe('resolveUserScope', () => {
  it('should return userName when user is present', () => {
    const ctx = createContext(undefined, new TestUser('alice'));
    expect(resolveUserScope(ctx)).toBe('alice');
  });

  it('should return "unknown" when no user is set', () => {
    const ctx = createContext();
    expect(resolveUserScope(ctx)).toBe('unknown');
  });

  it('should return "unknown" when userName is empty', () => {
    const ctx = createContext(undefined, new TestUser(''));
    expect(resolveUserScope(ctx)).toBe('unknown');
  });
});

describe('InMemoryTaskStore owner isolation', () => {
  let store: InMemoryTaskStore;

  beforeEach(() => {
    store = new InMemoryTaskStore();
  });

  it('should isolate tasks between different owners', async () => {
    const ctxAlice = createContext(undefined, new TestUser('alice'));
    const ctxBob = createContext(undefined, new TestUser('bob'));

    await store.save(createTask('task-1'), ctxAlice);

    // Alice can load her task
    const loadedAlice = await store.load('task-1', ctxAlice);
    expect(loadedAlice).toBeDefined();
    expect(loadedAlice!.id).toBe('task-1');

    // Bob cannot load Alice's task
    const loadedBob = await store.load('task-1', ctxBob);
    expect(loadedBob).toBeUndefined();
  });

  it('should allow same task ID for different owners', async () => {
    const ctxAlice = createContext(undefined, new TestUser('alice'));
    const ctxBob = createContext(undefined, new TestUser('bob'));

    await store.save(createTask('task-1', 'ctx-alice'), ctxAlice);
    await store.save(createTask('task-1', 'ctx-bob'), ctxBob);

    const loadedAlice = await store.load('task-1', ctxAlice);
    const loadedBob = await store.load('task-1', ctxBob);

    expect(loadedAlice!.contextId).toBe('ctx-alice');
    expect(loadedBob!.contextId).toBe('ctx-bob');
  });

  it('should list only tasks belonging to the owner', async () => {
    const ctxAlice = createContext(undefined, new TestUser('alice'));
    const ctxBob = createContext(undefined, new TestUser('bob'));
    const ctxCharlie = createContext(undefined, new TestUser('charlie'));

    await store.save(createTask('task-a1'), ctxAlice);
    await store.save(createTask('task-a2'), ctxAlice);
    await store.save(createTask('task-b1'), ctxBob);

    const listAlice = await store.list(listParams, ctxAlice);
    expect(listAlice.tasks).toHaveLength(2);
    expect(listAlice.tasks.map((t) => t.id).sort()).toEqual(['task-a1', 'task-a2']);

    const listBob = await store.list(listParams, ctxBob);
    expect(listBob.tasks).toHaveLength(1);
    expect(listBob.tasks[0].id).toBe('task-b1');

    // Non-existent owner sees nothing
    const listCharlie = await store.list(listParams, ctxCharlie);
    expect(listCharlie.tasks).toHaveLength(0);
  });

  it('should not allow cross-owner visibility', async () => {
    const ctxAlice = createContext(undefined, new TestUser('alice'));
    const ctxBob = createContext(undefined, new TestUser('bob'));

    await store.save(createTask('task-1'), ctxAlice);

    // Bob's save to a different task won't affect Alice
    await store.save(createTask('task-2'), ctxBob);

    // Alice's task still exists (no cross-owner mutation via save with same ID)
    const loaded = await store.load('task-1', ctxAlice);
    expect(loaded).toBeDefined();

    // Bob cannot see Alice's task
    const loadedBob = await store.load('task-1', ctxBob);
    expect(loadedBob).toBeUndefined();
  });

  it('should isolate owners within the same tenant', async () => {
    const ctxAliceT1 = createContext('tenant-1', new TestUser('alice'));
    const ctxBobT1 = createContext('tenant-1', new TestUser('bob'));

    await store.save(createTask('task-1'), ctxAliceT1);

    // Same tenant, different owner: cannot see the task
    const loadedBob = await store.load('task-1', ctxBobT1);
    expect(loadedBob).toBeUndefined();

    // Same tenant, same owner: can see the task
    const loadedAlice = await store.load('task-1', ctxAliceT1);
    expect(loadedAlice).toBeDefined();
  });

  it('should isolate same owner across different tenants', async () => {
    const ctxAliceT1 = createContext('tenant-1', new TestUser('alice'));
    const ctxAliceT2 = createContext('tenant-2', new TestUser('alice'));

    await store.save(createTask('task-1'), ctxAliceT1);

    // Same owner, different tenant: cannot see the task
    const loaded = await store.load('task-1', ctxAliceT2);
    expect(loaded).toBeUndefined();
  });

  it('should accept a custom OwnerResolver', async () => {
    // Custom resolver that uses a fixed scope
    const customStore = new InMemoryTaskStore(() => 'shared-scope');

    const ctx1 = createContext(undefined, new TestUser('alice'));
    const ctx2 = createContext(undefined, new TestUser('bob'));

    await customStore.save(createTask('task-1'), ctx1);

    // Both contexts resolve to the same owner, so both can see the task
    const loaded1 = await customStore.load('task-1', ctx1);
    const loaded2 = await customStore.load('task-1', ctx2);
    expect(loaded1).toBeDefined();
    expect(loaded2).toBeDefined();
  });
});

describe('InMemoryPushNotificationStore owner isolation', () => {
  let store: InMemoryPushNotificationStore;

  const createPushConfig = (id: string, taskId: string): TaskPushNotificationConfig => ({
    tenant: '',
    id,
    taskId,
    url: `https://notify.example.com/${id}`,
    token: 'secret',
    authentication: undefined,
  });

  beforeEach(() => {
    store = new InMemoryPushNotificationStore();
  });

  it('should isolate configs between different owners', async () => {
    const ctxAlice = createContext(undefined, new TestUser('alice'));
    const ctxBob = createContext(undefined, new TestUser('bob'));

    await store.save('task-1', ctxAlice, createPushConfig('config-1', 'task-1'));

    // Alice can load her config
    const loadedAlice = await store.load('task-1', ctxAlice);
    expect(loadedAlice).toHaveLength(1);
    expect(loadedAlice[0].id).toBe('config-1');

    // Bob cannot load Alice's config
    const loadedBob = await store.load('task-1', ctxBob);
    expect(loadedBob).toHaveLength(0);
  });

  it('should allow same task ID configs for different owners', async () => {
    const ctxAlice = createContext(undefined, new TestUser('alice'));
    const ctxBob = createContext(undefined, new TestUser('bob'));

    await store.save('task-1', ctxAlice, createPushConfig('config-a', 'task-1'));
    await store.save('task-1', ctxBob, createPushConfig('config-b', 'task-1'));

    const loadedAlice = await store.load('task-1', ctxAlice);
    const loadedBob = await store.load('task-1', ctxBob);

    expect(loadedAlice).toHaveLength(1);
    expect(loadedAlice[0].id).toBe('config-a');
    expect(loadedBob).toHaveLength(1);
    expect(loadedBob[0].id).toBe('config-b');
  });

  it('should not allow cross-owner deletion', async () => {
    const ctxAlice = createContext(undefined, new TestUser('alice'));
    const ctxBob = createContext(undefined, new TestUser('bob'));

    await store.save('task-1', ctxAlice, createPushConfig('config-1', 'task-1'));
    await store.save('task-1', ctxBob, createPushConfig('config-2', 'task-1'));

    // Bob tries to delete Alice's config -- should be a no-op
    await store.delete('task-1', ctxBob, 'config-1');

    // Alice's config still exists
    const loadedAlice = await store.load('task-1', ctxAlice);
    expect(loadedAlice).toHaveLength(1);
    expect(loadedAlice[0].id).toBe('config-1');

    // Bob's config still exists
    const loadedBob = await store.load('task-1', ctxBob);
    expect(loadedBob).toHaveLength(1);
    expect(loadedBob[0].id).toBe('config-2');
  });

  it('should isolate owners within the same tenant', async () => {
    const ctxAliceT1 = createContext('tenant-1', new TestUser('alice'));
    const ctxBobT1 = createContext('tenant-1', new TestUser('bob'));

    await store.save('task-1', ctxAliceT1, createPushConfig('config-1', 'task-1'));

    // Same tenant, different owner: cannot see
    const loadedBob = await store.load('task-1', ctxBobT1);
    expect(loadedBob).toHaveLength(0);

    // Same tenant, same owner: can see
    const loadedAlice = await store.load('task-1', ctxAliceT1);
    expect(loadedAlice).toHaveLength(1);
  });

  it('should accept a custom OwnerResolver', async () => {
    const customStore = new InMemoryPushNotificationStore(() => 'shared-scope');

    const ctx1 = createContext(undefined, new TestUser('alice'));
    const ctx2 = createContext(undefined, new TestUser('bob'));

    await customStore.save('task-1', ctx1, createPushConfig('config-1', 'task-1'));

    // Both contexts resolve to same owner, so both can see
    const loaded1 = await customStore.load('task-1', ctx1);
    const loaded2 = await customStore.load('task-1', ctx2);
    expect(loaded1).toHaveLength(1);
    expect(loaded2).toHaveLength(1);
  });
});

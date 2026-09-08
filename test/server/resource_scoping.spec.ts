import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTaskStore } from '../../src/server/store.js';
import { DefaultExecutionEventBusManager } from '../../src/server/events/execution_event_bus_manager.js';
import { InMemoryPushNotificationStore } from '../../src/server/push_notification/push_notification_store.js';
import { ServerCallContext } from '../../src/server/context.js';
import { resolveUserScope } from '../../src/server/owner_resolver.js';
import {
  Task,
  TaskState,
  TaskPushNotificationConfig,
  ListTasksRequest,
  AgentCard,
  Message,
  Role,
} from '../../src/index.js';
import { DefaultRequestHandler } from '../../src/server/index.js';
import { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';
import { RequestContext } from '../../src/server/agent_execution/request_context.js';
import { AgentEvent, ExecutionEventBus } from '../../src/server/events/execution_event_bus.js';
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

    const loadedA = await store.load('task-1', ctxA);
    expect(loadedA).toBeDefined();

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

    const loadedA = await store.load('task-1', ctxA);
    expect(loadedA).toHaveLength(1);
    expect(loadedA[0].id).to.equal('config-1');

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

    await store.delete('task-1', ctxA, 'config-1');

    const loadedA = await store.load('task-1', ctxA);
    expect(loadedA).toHaveLength(0);

    const loadedB = await store.load('task-1', ctxB);
    expect(loadedB).toHaveLength(1);
  });
});

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

    const loadedAlice = await store.load('task-1', ctxAlice);
    expect(loadedAlice).toBeDefined();
    expect(loadedAlice!.id).toBe('task-1');

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

    const listCharlie = await store.list(listParams, ctxCharlie);
    expect(listCharlie.tasks).toHaveLength(0);
  });

  it('should not allow cross-owner visibility', async () => {
    const ctxAlice = createContext(undefined, new TestUser('alice'));
    const ctxBob = createContext(undefined, new TestUser('bob'));

    await store.save(createTask('task-1'), ctxAlice);

    await store.save(createTask('task-2'), ctxBob);

    const loaded = await store.load('task-1', ctxAlice);
    expect(loaded).toBeDefined();

    const loadedBob = await store.load('task-1', ctxBob);
    expect(loadedBob).toBeUndefined();
  });

  it('should isolate owners within the same tenant', async () => {
    const ctxAliceT1 = createContext('tenant-1', new TestUser('alice'));
    const ctxBobT1 = createContext('tenant-1', new TestUser('bob'));

    await store.save(createTask('task-1'), ctxAliceT1);

    const loadedBob = await store.load('task-1', ctxBobT1);
    expect(loadedBob).toBeUndefined();

    const loadedAlice = await store.load('task-1', ctxAliceT1);
    expect(loadedAlice).toBeDefined();
  });

  it('should isolate same owner across different tenants', async () => {
    const ctxAliceT1 = createContext('tenant-1', new TestUser('alice'));
    const ctxAliceT2 = createContext('tenant-2', new TestUser('alice'));

    await store.save(createTask('task-1'), ctxAliceT1);

    const loaded = await store.load('task-1', ctxAliceT2);
    expect(loaded).toBeUndefined();
  });

  it('should accept a custom OwnerResolver', async () => {
    const customStore = new InMemoryTaskStore(() => 'shared-scope');

    const ctx1 = createContext(undefined, new TestUser('alice'));
    const ctx2 = createContext(undefined, new TestUser('bob'));

    await customStore.save(createTask('task-1'), ctx1);

    // Both contexts resolve to the same scope.
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

    const loadedAlice = await store.load('task-1', ctxAlice);
    expect(loadedAlice).toHaveLength(1);
    expect(loadedAlice[0].id).toBe('config-1');

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

    // Cross-owner delete is a no-op.
    await store.delete('task-1', ctxBob, 'config-1');

    const loadedAlice = await store.load('task-1', ctxAlice);
    expect(loadedAlice).toHaveLength(1);
    expect(loadedAlice[0].id).toBe('config-1');

    const loadedBob = await store.load('task-1', ctxBob);
    expect(loadedBob).toHaveLength(1);
    expect(loadedBob[0].id).toBe('config-2');
  });

  it('should isolate owners within the same tenant', async () => {
    const ctxAliceT1 = createContext('tenant-1', new TestUser('alice'));
    const ctxBobT1 = createContext('tenant-1', new TestUser('bob'));

    await store.save('task-1', ctxAliceT1, createPushConfig('config-1', 'task-1'));

    const loadedBob = await store.load('task-1', ctxBobT1);
    expect(loadedBob).toHaveLength(0);

    const loadedAlice = await store.load('task-1', ctxAliceT1);
    expect(loadedAlice).toHaveLength(1);
  });

  it('should accept a custom OwnerResolver', async () => {
    const customStore = new InMemoryPushNotificationStore(() => 'shared-scope');

    const ctx1 = createContext(undefined, new TestUser('alice'));
    const ctx2 = createContext(undefined, new TestUser('bob'));

    await customStore.save('task-1', ctx1, createPushConfig('config-1', 'task-1'));

    const loaded1 = await customStore.load('task-1', ctx1);
    const loaded2 = await customStore.load('task-1', ctx2);
    expect(loaded1).toHaveLength(1);
    expect(loaded2).toHaveLength(1);
  });
});

describe('DefaultExecutionEventBusManager scope isolation', () => {
  let manager: DefaultExecutionEventBusManager;

  beforeEach(() => {
    manager = new DefaultExecutionEventBusManager();
  });

  it('should isolate buses between tenants for the same task ID', () => {
    const ctxA = createContext('tenant-A');
    const ctxB = createContext('tenant-B');

    const busA = manager.createOrGetByTaskId('collision-task', ctxA);

    expect(manager.getByTaskId('collision-task', ctxB)).toBeUndefined();
    expect(manager.createOrGetByTaskId('collision-task', ctxB)).not.toBe(busA);
    expect(manager.getByTaskId('collision-task', ctxA)).toBe(busA);
  });

  it('should isolate buses between owners for the same task ID', () => {
    const ctxAlice = createContext(undefined, new TestUser('alice'));
    const ctxBob = createContext(undefined, new TestUser('bob'));

    const busAlice = manager.createOrGetByTaskId('collision-task', ctxAlice);

    expect(manager.getByTaskId('collision-task', ctxBob)).toBeUndefined();
    expect(manager.createOrGetByTaskId('collision-task', ctxBob)).not.toBe(busAlice);
  });

  it('should return the same bus within one scope', () => {
    const ctx = createContext('tenant-A', new TestUser('alice'));
    const bus = manager.createOrGetByTaskId('task-1', ctx);
    expect(manager.createOrGetByTaskId('task-1', ctx)).toBe(bus);
    expect(manager.getByTaskId('task-1', ctx)).toBe(bus);
  });

  it('cleanup should only remove the calling scope’s bus', () => {
    const ctxA = createContext('tenant-A');
    const ctxB = createContext('tenant-B');
    manager.createOrGetByTaskId('collision-task', ctxA);
    const busB = manager.createOrGetByTaskId('collision-task', ctxB);

    manager.cleanupByTaskId('collision-task', ctxA);

    expect(manager.getByTaskId('collision-task', ctxA)).toBeUndefined();
    expect(manager.getByTaskId('collision-task', ctxB)).toBe(busB);
  });

  it('cleanup for an unknown scope should be a no-op, not a throw', () => {
    const ctxA = createContext('tenant-A');
    const busA = manager.createOrGetByTaskId('task-1', ctxA);

    expect(() => manager.cleanupByTaskId('task-1', createContext('tenant-Z'))).not.toThrow();
    expect(manager.getByTaskId('task-1', ctxA)).toBe(busA);
  });

  it('should default to one shared scope when the context is omitted', () => {
    const bus = manager.createOrGetByTaskId('task-1');
    expect(manager.getByTaskId('task-1')).to.equal(bus);

    // The implicit scope is the same bucket an unauthenticated, untenanted
    // request resolves to, so a context-less caller and a plain request agree.
    expect(manager.getByTaskId('task-1', createContext())).to.equal(bus);

    // ...and it stays separate from any real tenant scope.
    expect(manager.getByTaskId('task-1', createContext('tenant-A'))).toBeUndefined();
  });

  it('should not let a context-less caller reach a tenant-scoped bus', () => {
    const busA = manager.createOrGetByTaskId('collision-task', createContext('tenant-A'));
    expect(manager.getByTaskId('collision-task')).toBeUndefined();
    expect(manager.createOrGetByTaskId('collision-task')).to.not.equal(busA);
  });

  it('should honour a custom OwnerResolver so co-owners share one bus', () => {
    const shared = new DefaultExecutionEventBusManager(() => 'shared-scope');
    const ctxAlice = createContext(undefined, new TestUser('alice'));
    const ctxBob = createContext(undefined, new TestUser('bob'));

    const bus = shared.createOrGetByTaskId('task-1', ctxAlice);
    expect(shared.getByTaskId('task-1', ctxBob)).toBe(bus);
  });
});

type Deferred = { promise: Promise<void>; resolve: () => void };

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('DefaultRequestHandler cross-scope live event isolation', () => {
  const COLLIDING_ID = 'collision-task';

  const agentCard: AgentCard = {
    name: 'Scope Isolation Agent',
    description: 'cross-scope regression',
    version: '1.0.0',
    provider: undefined,
    documentationUrl: '',
    supportedInterfaces: [
      {
        url: 'http://localhost/a2a',
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    capabilities: { extensions: [], streaming: true, pushNotifications: false },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };

  /** Publishes a Task, then parks so the bus stays live. */
  class ParkingExecutor implements AgentExecutor {
    public capturedBus?: ExecutionEventBus;
    public started: Deferred = createDeferred();
    public release: Deferred = createDeferred();
    public cancelCalls: string[] = [];

    async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
      this.capturedBus = bus;
      bus.publish(
        AgentEvent.task({
          id: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
          artifacts: [],
          history: [],
          metadata: {},
        })
      );
      this.started.resolve();
      await this.release.promise;
      bus.finished();
    }

    async cancelTask(taskId: string): Promise<void> {
      this.cancelCalls.push(taskId);
    }
  }

  const collidingTask = (contextId: string, secret: string): Task => ({
    id: COLLIDING_ID,
    contextId,
    status: {
      state: TaskState.TASK_STATE_SUBMITTED,
      timestamp: new Date().toISOString(),
      message: undefined,
    },
    artifacts: [],
    history: [],
    metadata: { secret },
  });

  const followUp = (): Message => ({
    messageId: crypto.randomUUID(),
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: 'text', value: 'continue' },
        mediaType: 'text/plain',
        filename: '',
        metadata: undefined,
      },
    ],
    taskId: COLLIDING_ID,
    contextId: '',
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  });

  let store: InMemoryTaskStore;
  let executor: ParkingExecutor;
  let handler: DefaultRequestHandler;
  const ctxA = new ServerCallContext({ tenant: 'tenant-A' });
  const ctxB = new ServerCallContext({ tenant: 'tenant-B' });

  beforeEach(async () => {
    store = new InMemoryTaskStore();
    executor = new ParkingExecutor();
    handler = new DefaultRequestHandler(
      agentCard,
      store,
      executor,
      new DefaultExecutionEventBusManager()
    );
    await store.save(collidingTask('context-a', 'TENANT_A_SECRET'), ctxA);
    await store.save(collidingTask('context-b', 'TENANT_B_SECRET'), ctxB);
  });

  afterEach(() => {
    executor.release.resolve();
  });

  /** Starts tenant A's live execution and waits for its bus to exist. */
  const startTenantALiveRun = async () => {
    const iterator = handler
      .sendMessageStream(
        { message: followUp(), tenant: '', configuration: undefined, metadata: {} },
        ctxA
      )
      [Symbol.asyncIterator]();
    await iterator.next();
    await executor.started.promise;
    return iterator;
  };

  it('resubscribe must not leak tenant A live events to tenant B', async () => {
    await startTenantALiveRun();

    const iteratorB = handler
      .resubscribe({ id: COLLIDING_ID, tenant: '' }, ctxB)
      [Symbol.asyncIterator]();
    const snapshot = await iteratorB.next();
    const next = iteratorB.next();

    executor.capturedBus!.publish(
      AgentEvent.statusUpdate({
        taskId: COLLIDING_ID,
        contextId: 'context-a',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: { secret: 'TENANT_A_SECRET' },
      })
    );

    // B sees only its own snapshot; with no bus in B's scope the stream ends.
    expect((snapshot.value as { payload: { value: Task } }).payload.value.contextId).to.equal(
      'context-b'
    );
    const settled = await next;
    expect(settled.done).to.equal(true);
    expect(JSON.stringify(settled.value ?? '')).to.not.contain('TENANT_A_SECRET');
  });

  it('cancelTask must not drive another scope’s executor or persist its data', async () => {
    await startTenantALiveRun();

    await handler.cancelTask({ id: COLLIDING_ID, tenant: '', metadata: {} }, ctxB);

    // B's cancel never reached the executor bound to A's live run.
    expect(executor.cancelCalls).to.deep.equal([]);

    const taskB = await store.load(COLLIDING_ID, ctxB);
    expect(taskB!.status?.state).to.equal(TaskState.TASK_STATE_CANCELED);
    expect(taskB!.contextId).to.equal('context-b');
    expect(JSON.stringify(taskB)).to.not.contain('TENANT_A_SECRET');

    // Tenant A's own task is untouched by B's cancel.
    const taskA = await store.load(COLLIDING_ID, ctxA);
    expect(taskA!.status?.state).to.not.equal(TaskState.TASK_STATE_CANCELED);
  });

  it('a co-scoped caller still reaches the live bus (isolation is not over-broad)', async () => {
    await startTenantALiveRun();

    const iteratorA2 = handler
      .resubscribe({ id: COLLIDING_ID, tenant: '' }, ctxA)
      [Symbol.asyncIterator]();
    await iteratorA2.next(); // snapshot
    const live = iteratorA2.next();

    executor.capturedBus!.publish(
      AgentEvent.statusUpdate({
        taskId: COLLIDING_ID,
        contextId: 'context-a',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: { marker: 'same-scope' },
      })
    );

    const received = await live;
    expect(received.done).to.equal(false);
    expect(JSON.stringify(received.value)).to.contain('same-scope');
  });
});

import { describe, it, beforeEach, expect } from 'vitest';

import {
  DefaultRequestHandler,
  InMemoryPushNotificationStore,
  InMemoryTaskStore,
  TaskStore,
} from '../../../src/server/index.js';
import {
  AgentCard,
  Task,
  TaskPushNotificationConfig,
  TaskState,
} from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

// id-less Create assigns a server-side UUID. Regression guard for the
// pre-fix `id ||= taskId` collapse that overwrote configs.
describe('DefaultRequestHandler.createTaskPushNotificationConfig (§3.1.7, §5.1)', () => {
  let handler: DefaultRequestHandler;
  let taskStore: TaskStore;
  let pushNotificationStore: InMemoryPushNotificationStore;

  const agentCard: AgentCard = {
    name: 'Push Notification Agent',
    description: 'Test agent for §3.1.7 / §5.1 push-notification create',
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
    capabilities: {
      extensions: [],
      streaming: true,
      pushNotifications: true,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };

  const serverContext = new ServerCallContext();

  beforeEach(async () => {
    taskStore = new InMemoryTaskStore();
    pushNotificationStore = new InMemoryPushNotificationStore();
    handler = new DefaultRequestHandler(
      agentCard,
      taskStore,
      new MockAgentExecutor(),
      new DefaultExecutionEventBusManager(),
      pushNotificationStore
    );
  });

  const makeTask = (id: string): Task => ({
    id,
    contextId: `ctx-${id}`,
    status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
    artifacts: [],
    history: [],
    metadata: {},
  });

  const makeIdLessConfig = (taskId: string, url: string): TaskPushNotificationConfig => ({
    tenant: '',
    taskId,
    id: '',
    url,
    token: '',
    authentication: undefined,
  });

  // §RFC 4122 v4: 8-4-4-4-12 hex digits, version nibble 4. The handler
  // uses `uuid.v4`; this matcher catches accidental swaps to other id
  // schemes (e.g. taskId fallback) without coupling to library specifics.
  const UUIDV4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('assigns a server-side UUID when params.id is empty and returns the persisted record', async () => {
    const taskId = 'task-idless-single';
    await taskStore.save(makeTask(taskId), serverContext);

    const result = await handler.createTaskPushNotificationConfig(
      makeIdLessConfig(taskId, 'https://example.test/webhook-1'),
      serverContext
    );

    expect(result.id).toMatch(UUIDV4_RE);
    expect(result.taskId).toBe(taskId);
    expect(result.url).toBe('https://example.test/webhook-1');

    // Verify persistence: the record returned must be the one in the
    // store, not a reflection of the input.
    const stored = await pushNotificationStore.load(taskId, serverContext);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(result.id);
  });

  it('produces distinct UUIDs for two id-less Creates (no silent upsert)', async () => {
    // Regression guard for the old `id ||= taskId` store fallback: two
    // parameter-less Creates used to collapse onto a single row keyed by
    // taskId, destroying the first config. They must now coexist with
    // distinct server-assigned ids.
    const taskId = 'task-idless-multi';
    await taskStore.save(makeTask(taskId), serverContext);

    const first = await handler.createTaskPushNotificationConfig(
      makeIdLessConfig(taskId, 'https://example.test/webhook-A'),
      serverContext
    );
    const second = await handler.createTaskPushNotificationConfig(
      makeIdLessConfig(taskId, 'https://example.test/webhook-B'),
      serverContext
    );

    expect(first.id).toMatch(UUIDV4_RE);
    expect(second.id).toMatch(UUIDV4_RE);
    expect(first.id).not.toBe(second.id);

    const stored = await pushNotificationStore.load(taskId, serverContext);
    expect(stored).toHaveLength(2);
    expect(stored.map((c) => c.id).sort()).toEqual([first.id, second.id].sort());
    expect(stored.map((c) => c.url).sort()).toEqual([
      'https://example.test/webhook-A',
      'https://example.test/webhook-B',
    ]);
  });

  it('preserves an explicit id and returns a deep clone (caller mutations cannot reach the store)', async () => {
    const taskId = 'task-explicit-id';
    await taskStore.save(makeTask(taskId), serverContext);

    const params: TaskPushNotificationConfig = {
      tenant: '',
      taskId,
      id: 'caller-chosen-id',
      url: 'https://example.test/webhook-explicit',
      token: 'shh',
      authentication: undefined,
    };
    const result = await handler.createTaskPushNotificationConfig(params, serverContext);

    expect(result.id).toBe('caller-chosen-id');
    expect(result.url).toBe('https://example.test/webhook-explicit');

    // The returned object must be a deep clone, not the input reference —
    // caller-side mutations of the returned value must not reach the
    // store's internal entry. Same isolation guarantee `store.load()`
    // provides.
    expect(result).not.toBe(params);
    result.url = 'https://attacker.test/';
    const stored = await pushNotificationStore.load(taskId, serverContext);
    expect(stored[0].url).toBe('https://example.test/webhook-explicit');
  });

  it('listTaskPushNotificationConfigs returns every entry after mixed id-less + explicit Creates', async () => {
    const taskId = 'task-list-after-multi';
    await taskStore.save(makeTask(taskId), serverContext);

    const idless1 = await handler.createTaskPushNotificationConfig(
      makeIdLessConfig(taskId, 'https://example.test/wh-1'),
      serverContext
    );
    const explicit = await handler.createTaskPushNotificationConfig(
      {
        tenant: '',
        taskId,
        id: 'pinned',
        url: 'https://example.test/wh-2',
        token: '',
        authentication: undefined,
      },
      serverContext
    );
    const idless2 = await handler.createTaskPushNotificationConfig(
      makeIdLessConfig(taskId, 'https://example.test/wh-3'),
      serverContext
    );

    const list = await handler.listTaskPushNotificationConfigs(
      { tenant: '', taskId, pageSize: 0, pageToken: '' },
      serverContext
    );

    expect(list.configs).toHaveLength(3);
    const idsSeen = list.configs.map((c) => c.id).sort();
    expect(idsSeen).toEqual([idless1.id, explicit.id, idless2.id].sort());
  });
});

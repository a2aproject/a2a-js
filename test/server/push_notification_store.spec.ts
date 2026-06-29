import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPushNotificationStore } from '../../src/server/push_notification/push_notification_store.js';
import { ServerCallContext } from '../../src/server/context.js';
import { TaskPushNotificationConfig } from '../../src/types/pb/a2a.js';
import { A2A_LEGACY_PROTOCOL_VERSION, A2A_PROTOCOL_VERSION } from '../../src/constants.js';

function makeConfig(
  overrides: Partial<TaskPushNotificationConfig> = {}
): TaskPushNotificationConfig {
  return {
    tenant: '',
    taskId: '',
    id: '',
    url: 'http://example.test/webhook',
    token: '',
    authentication: undefined,
    ...overrides,
  };
}

describe('InMemoryPushNotificationStore.load() (canonical, version-agnostic read)', () => {
  let store: InMemoryPushNotificationStore;

  beforeEach(() => {
    store = new InMemoryPushNotificationStore();
  });

  it('returns the stored configs without wire-version wrappers', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    const config = makeConfig({ id: 'cfg-1', url: 'http://example.test/wh1' });

    await store.save('task-1', context, config);
    const loaded = await store.load('task-1', context);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(config);
  });

  it('returns an empty array when no configs are stored for the task', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    const loaded = await store.load('missing-task', context);
    expect(loaded).toEqual([]);
  });

  it('assigns a server-side UUID when saved with an empty config id', async () => {
    // The id is the *result* of Create, not an input requirement. The
    // store assigns a UUID at the save boundary so every entry point —
    // `createTaskPushNotificationConfig`, `sendMessage`'s and
    // `sendMessageStream`'s
    // `params.configuration.taskPushNotificationConfig` paths — gets
    // the same auto-assignment.
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });

    await store.save('task-id-empty', context, makeConfig({ id: '' }));
    await store.save('task-id-empty', context, makeConfig({ id: '' }));
    const loaded = await store.load('task-id-empty', context);

    expect(loaded).toHaveLength(2);
    const UUIDV4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(loaded[0].id).toMatch(UUIDV4_RE);
    expect(loaded[1].id).toMatch(UUIDV4_RE);
    expect(loaded[0].id).not.toBe(loaded[1].id);
  });

  it('delete() matches against the config id', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save('task-del', context, makeConfig({ id: 'keep' }));
    await store.save('task-del', context, makeConfig({ id: 'remove' }));

    await store.delete('task-del', context, 'remove');

    const remaining = await store.load('task-del', context);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('keep');
  });

  it('returns deep-cloned configs so caller mutations cannot reach internal state', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save('task-iso', context, makeConfig({ id: 'cfg-iso', url: 'http://orig/' }));

    const first = await store.load('task-iso', context);
    expect(first).toHaveLength(1);

    first.pop();
    first.push(makeConfig({ id: 'attacker' }));
    const second = await store.load('task-iso', context);
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('cfg-iso');

    // Deep-clone check: inner-object mutation must not leak either.
    second[0].url = 'http://evil/';
    const third = await store.load('task-iso', context);
    expect(third[0].url).toBe('http://orig/');
  });
});

describe('InMemoryPushNotificationStore.loadWithMetadata() wire-version capture', () => {
  let store: InMemoryPushNotificationStore;

  beforeEach(() => {
    store = new InMemoryPushNotificationStore();
  });

  it('captures the requested wire version from the context on save()', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    const config = makeConfig({ id: 'cfg-1', url: 'http://example.test/wh1' });

    await store.save('task-1', context, config);
    const loaded = await store.loadWithMetadata('task-1', context);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].config).toEqual(config);
    expect(loaded[0].wireVersion).toBe(A2A_PROTOCOL_VERSION);
  });

  it('defaults the stored wire version to 0.3 when the context has no header', async () => {
    // ServerCallContext applies ABSENT_HEADER_VERSION = '0.3' when no
    // header is set. The store should surface that value.
    const context = new ServerCallContext();
    const config = makeConfig({ id: 'cfg-default', url: 'http://example.test/wh-default' });

    await store.save('task-default', context, config);
    const loaded = await store.loadWithMetadata('task-default', context);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].wireVersion).toBe(A2A_LEGACY_PROTOCOL_VERSION);
  });

  it("defaults to '0.3' when context.requestedVersion is explicitly empty (§3.6.2)", async () => {
    // Defensive: caller constructs a context with explicit empty version.
    // The store's fallback should still resolve to '0.3' (NOT '1.0').
    const context = new ServerCallContext({ requestedVersion: '' });
    const config = makeConfig({ id: 'cfg-empty' });

    await store.save('task-empty', context, config);
    const loaded = await store.loadWithMetadata('task-empty', context);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].wireVersion).toBe(A2A_LEGACY_PROTOCOL_VERSION);
  });

  it('preserves the stored wire version across multiple configs on the same task', async () => {
    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    const ctxV03 = new ServerCallContext({ requestedVersion: A2A_LEGACY_PROTOCOL_VERSION });

    await store.save('task-mixed', ctxV1, makeConfig({ id: 'v1-cfg' }));
    await store.save('task-mixed', ctxV03, makeConfig({ id: 'v03-cfg' }));

    // The two saves use different ServerCallContext instances but with the
    // same (default) user/tenant scope, so they share the same bucket and we
    // can load them via either context.
    const loaded = await store.loadWithMetadata('task-mixed', ctxV1);

    expect(loaded).toHaveLength(2);
    const byId = Object.fromEntries(loaded.map((e) => [e.config.id, e.wireVersion]));
    expect(byId['v1-cfg']).toBe(A2A_PROTOCOL_VERSION);
    expect(byId['v03-cfg']).toBe(A2A_LEGACY_PROTOCOL_VERSION);
  });

  it('updates the stored wire version when a config with the same id is overwritten', async () => {
    const ctxV03 = new ServerCallContext({ requestedVersion: A2A_LEGACY_PROTOCOL_VERSION });
    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });

    await store.save('task-overwrite', ctxV03, makeConfig({ id: 'cfg-overwrite' }));
    await store.save(
      'task-overwrite',
      ctxV1,
      makeConfig({ id: 'cfg-overwrite', url: 'http://example.test/changed' })
    );

    const loaded = await store.loadWithMetadata('task-overwrite', ctxV1);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].wireVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(loaded[0].config.url).toBe('http://example.test/changed');
  });

  it('returns deep-cloned wrappers so caller mutations cannot reach internal state', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save(
      'task-iso-meta',
      context,
      makeConfig({ id: 'cfg-iso-meta', url: 'http://orig/' })
    );

    const first = await store.loadWithMetadata('task-iso-meta', context);
    expect(first).toHaveLength(1);

    first.pop();
    first.push({
      config: makeConfig({ id: 'attacker' }),
      wireVersion: A2A_PROTOCOL_VERSION,
    });
    const second = await store.loadWithMetadata('task-iso-meta', context);
    expect(second).toHaveLength(1);
    expect(second[0].config.id).toBe('cfg-iso-meta');

    second[0].config.url = 'http://evil/';
    const third = await store.loadWithMetadata('task-iso-meta', context);
    expect(third[0].config.url).toBe('http://orig/');
  });

  it('loadWithMetadata() returns empty array when no configs stored', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    const loaded = await store.loadWithMetadata('missing-task', context);
    expect(loaded).toEqual([]);
  });
});

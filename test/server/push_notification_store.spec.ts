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

describe('InMemoryPushNotificationStore wire-version capture', () => {
  let store: InMemoryPushNotificationStore;

  beforeEach(() => {
    store = new InMemoryPushNotificationStore();
  });

  it('captures the requested wire version from the context on save()', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    const config = makeConfig({ id: 'cfg-1', url: 'http://example.test/wh1' });

    await store.save('task-1', context, config);
    const loaded = await store.load('task-1', context);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].config).toEqual(config);
    expect(loaded[0].wireVersion).toBe(A2A_PROTOCOL_VERSION);
  });

  it('defaults the stored wire version to 0.3 when the context has no header', async () => {
    // ServerCallContext applies ABSENT_HEADER_VERSION = '0.3' when no header
    // is set (per spec §3.6.2). The store should surface that value.
    const context = new ServerCallContext();
    const config = makeConfig({ id: 'cfg-default', url: 'http://example.test/wh-default' });

    await store.save('task-default', context, config);
    const loaded = await store.load('task-default', context);

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
    const loaded = await store.load('task-mixed', ctxV1);

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

    const loaded = await store.load('task-overwrite', ctxV1);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].wireVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(loaded[0].config.url).toBe('http://example.test/changed');
  });

  it('delete() matches against the inner config id, not the wrapper', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save('task-del', context, makeConfig({ id: 'keep' }));
    await store.save('task-del', context, makeConfig({ id: 'remove' }));

    await store.delete('task-del', context, 'remove');

    const remaining = await store.load('task-del', context);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].config.id).toBe('keep');
  });

  it('load() returns an empty array when no configs are stored for the task', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    const loaded = await store.load('missing-task', context);
    expect(loaded).toEqual([]);
  });

  it('defaults a missing config id to the taskId on save', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    const config = makeConfig({ id: '' });

    await store.save('task-id-default', context, config);
    const loaded = await store.load('task-id-default', context);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].config.id).toBe('task-id-default');
  });

  it('load() returns a shallow copy that cannot mutate the stored bucket', async () => {
    const context = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save('task-iso', context, makeConfig({ id: 'cfg-iso' }));

    const first = await store.load('task-iso', context);
    expect(first).toHaveLength(1);

    // Caller-side mutations of the returned array must not affect the
    // store's internal bucket.
    first.pop();
    first.push({
      config: makeConfig({ id: 'attacker' }),
      wireVersion: A2A_PROTOCOL_VERSION,
    });

    const second = await store.load('task-iso', context);
    expect(second).toHaveLength(1);
    expect(second[0].config.id).toBe('cfg-iso');
  });
});

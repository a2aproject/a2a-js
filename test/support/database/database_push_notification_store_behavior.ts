// The DatabasePushNotificationStore tests every runtime has to pass: the Node suite runs
// them on each engine, the edge suite on D1, and each hands them its database through a
// StoreHarness. Imported in workerd too, so nothing here may pull in a Node built-in.
import { beforeEach, describe, expect, it } from 'vitest';

import { DatabasePushNotificationStore } from '../../../src/server/database/push_notification/store.js';
import { A2A_LEGACY_PROTOCOL_VERSION, A2A_PROTOCOL_VERSION } from '../../../src/constants.js';

import { makeConfig, makeContext } from './builders.js';
import type { StoreHarness } from './store_harness.js';

// Spelled out rather than imported from the store
const TABLE = 'push_notification_configs';
const UUIDV4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** What a deployment that renamed the table would have instead, ledger included. */
export const RENAMED_TABLE = 'agent_push_configs';
export const RENAMED_LEDGER_TABLE = 'a2a_agent_push_configs_migrations';

/**
 * Declares the tests in the caller's describe. The caller's beforeEach runs first, since it
 * was declared first, and leaves the database this one builds the store on.
 */
export function describeDatabasePushNotificationStoreBehavior(harness: StoreHarness): void {
  const { execute, rowsInTable } = harness;
  let store: DatabasePushNotificationStore;

  beforeEach(() => {
    store = new DatabasePushNotificationStore(harness.db());
  });

  describe('save() and load()', () => {
    it('round-trips a fully populated config', async () => {
      const config = makeConfig({
        tenant: 'acme',
        authentication: { scheme: 'Bearer', credentials: 'token' },
      });
      const context = makeContext({ tenant: 'acme', version: A2A_PROTOCOL_VERSION });

      await store.save('task-1', context, config);

      expect(await store.load('task-1', context)).toEqual([config]);
    });

    it('returns an empty array when the task has no configs', async () => {
      expect(await store.load('task-unknown', makeContext())).toEqual([]);
    });

    it('survives the connection that wrote it', async () => {
      await store.save('task-1', makeContext(), makeConfig());

      // A whole new connection and store, as a restarted process or a fresh isolate would have.
      const restarted = new DatabasePushNotificationStore(await harness.reconnect());

      expect(await restarted.load('task-1', makeContext())).toEqual([makeConfig()]);
    });

    it('assigns a UUID when saved with an empty config id', async () => {
      const context = makeContext();
      await store.save('task-1', context, makeConfig({ id: '' }));
      await store.save('task-1', context, makeConfig({ id: '' }));

      const loaded = await store.load('task-1', context);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toMatch(UUIDV4_RE);
      expect(loaded[1].id).toMatch(UUIDV4_RE);
      expect(loaded[0].id).not.toBe(loaded[1].id);
    });

    it('writes the generated id onto the caller object', async () => {
      const config = makeConfig({ id: '' });

      await store.save('task-1', makeContext(), config);

      expect(config.id).toMatch(UUIDV4_RE);
    });

    it('replaces rather than duplicates when an id is saved twice', async () => {
      const context = makeContext();
      await store.save('task-1', context, makeConfig({ url: 'https://first.test/' }));
      await store.save('task-1', context, makeConfig({ url: 'https://second.test/' }));

      const loaded = await store.load('task-1', context);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].url).toBe('https://second.test/');
    });

    it('keeps configs on different tasks apart', async () => {
      const context = makeContext();
      await store.save('task-1', context, makeConfig({ id: 'a', taskId: 'task-1' }));
      await store.save('task-2', context, makeConfig({ id: 'b', taskId: 'task-2' }));

      expect((await store.load('task-1', context)).map((config) => config.id)).toEqual(['a']);
      expect((await store.load('task-2', context)).map((config) => config.id)).toEqual(['b']);
    });

    it('returns every config for the task', async () => {
      const context = makeContext();
      for (const id of ['cfg-c', 'cfg-a', 'cfg-b']) {
        await store.save('task-1', context, makeConfig({ id }));
      }

      // No ORDER BY, so compare as a set.
      const loaded = await store.load('task-1', context);
      expect(loaded.map((config) => config.id).sort()).toEqual(['cfg-a', 'cfg-b', 'cfg-c']);
    });

    it('reads a row whose payload is null as a config with only its key', async () => {
      await store.save('task-1', makeContext(), makeConfig());
      await execute(`update ${TABLE} set config_data = null`);

      const [entry] = await store.loadWithMetadata('task-1', makeContext());
      expect(entry.config).toEqual({
        tenant: '',
        id: 'cfg-1',
        taskId: 'task-1',
        url: '',
        token: '',
        authentication: undefined,
      });
      expect(entry.wireVersion).toBe(A2A_LEGACY_PROTOCOL_VERSION);
    });

    // A row written by an older version or another SDK carries no wire version.
    it('reads a row whose payload omits the wire version as 0.3', async () => {
      await store.save('task-1', makeContext({ version: A2A_PROTOCOL_VERSION }), makeConfig());
      await execute(`update ${TABLE} set config_data = '{"url":"https://plain.test/"}'`);

      const [entry] = await store.loadWithMetadata('task-1', makeContext());
      expect(entry.config.url).toBe('https://plain.test/');
      expect(entry.wireVersion).toBe(A2A_LEGACY_PROTOCOL_VERSION);
    });

    it('keeps the stored values when the caller mutates the config after save', async () => {
      const config = makeConfig();
      await store.save('task-1', makeContext(), config);

      config.url = 'https://attacker.test/';
      config.token = 'stolen';

      const [loaded] = await store.load('task-1', makeContext());
      expect(loaded.url).toBe('http://example.test/webhook');
      expect(loaded.token).toBe('token');
    });

    it('does not let a mutated result reach the next load', async () => {
      const context = makeContext();
      await store.save('task-1', context, makeConfig());

      const first = await store.load('task-1', context);
      first[0].url = 'https://attacker.test/';

      const [second] = await store.load('task-1', context);
      expect(second.url).toBe('http://example.test/webhook');
    });
  });

  describe('stored row shape', () => {
    it('writes the scope into columns and leaves them out of the payload', async () => {
      await store.save(
        'task-1',
        makeContext({ tenant: 'acme', user: 'alice', version: A2A_PROTOCOL_VERSION }),
        makeConfig({ tenant: 'other-tenant' })
      );

      const rows = await rowsInTable();
      expect(rows).toHaveLength(1);
      expect(rows[0].tenant).toBe('acme');
      expect(rows[0].owner).toBe('alice');
      expect(rows[0].task_id).toBe('task-1');
      expect(rows[0].config_id).toBe('cfg-1');
      expect(JSON.parse(String(rows[0].config_data))).toEqual({
        url: 'http://example.test/webhook',
        token: 'token',
        wireVersion: A2A_PROTOCOL_VERSION,
      });
    });

    it('writes protocol_version as the storage format, not the wire version', async () => {
      await store.save(
        'task-1',
        makeContext({ version: A2A_LEGACY_PROTOCOL_VERSION }),
        makeConfig()
      );

      const rows = await rowsInTable();
      expect(rows[0].protocol_version).toBe('1.0');
      expect(JSON.parse(String(rows[0].config_data)).wireVersion).toBe(A2A_LEGACY_PROTOCOL_VERSION);
    });
  });

  describe('loadWithMetadata()', () => {
    it('captures the wire version the config was registered over', async () => {
      const context = makeContext({ version: A2A_LEGACY_PROTOCOL_VERSION });
      await store.save('task-1', context, makeConfig());

      const [entry] = await store.loadWithMetadata('task-1', context);
      expect(entry.wireVersion).toBe(A2A_LEGACY_PROTOCOL_VERSION);
    });

    it('stores 0.3 for a context that states no version', async () => {
      const context = makeContext();
      await store.save('task-1', context, makeConfig());

      const [entry] = await store.loadWithMetadata('task-1', context);
      expect(entry.wireVersion).toBe(A2A_LEGACY_PROTOCOL_VERSION);
    });

    // ServerCallContext turns an empty version into 0.3, so this asserts the
    // end-to-end result rather than anything the store itself decides.
    it('stores 0.3 for a context whose version is explicitly empty', async () => {
      const context = makeContext({ version: '' });
      await store.save('task-1', context, makeConfig());

      const [entry] = await store.loadWithMetadata('task-1', context);
      expect(entry.wireVersion).toBe(A2A_LEGACY_PROTOCOL_VERSION);
    });

    it('keeps a wire version per config on the same task', async () => {
      await store.save(
        'task-1',
        makeContext({ version: A2A_PROTOCOL_VERSION }),
        makeConfig({ id: 'cfg-a' })
      );
      await store.save(
        'task-1',
        makeContext({ version: A2A_LEGACY_PROTOCOL_VERSION }),
        makeConfig({ id: 'cfg-b' })
      );

      // No ORDER BY, so key by config id rather than position.
      const entries = await store.loadWithMetadata('task-1', makeContext());
      expect(Object.fromEntries(entries.map((e) => [e.config.id, e.wireVersion]))).toEqual({
        'cfg-a': A2A_PROTOCOL_VERSION,
        'cfg-b': A2A_LEGACY_PROTOCOL_VERSION,
      });
    });

    it('updates the wire version when a config is overwritten', async () => {
      await store.save(
        'task-1',
        makeContext({ version: A2A_LEGACY_PROTOCOL_VERSION }),
        makeConfig()
      );
      await store.save('task-1', makeContext({ version: A2A_PROTOCOL_VERSION }), makeConfig());

      // Length first: the read has no ORDER BY, so a failed upsert leaving two rows
      // could otherwise return the newer one and pass.
      const entries = await store.loadWithMetadata('task-1', makeContext());
      expect(entries).toHaveLength(1);
      expect(entries[0].wireVersion).toBe(A2A_PROTOCOL_VERSION);
    });

    it('returns an empty array when the task has no configs', async () => {
      expect(await store.loadWithMetadata('task-unknown', makeContext())).toEqual([]);
    });

    it('skips an unreadable row and returns the rest', async () => {
      const context = makeContext();
      await store.save('task-1', context, makeConfig({ id: 'cfg-a' }));
      await store.save('task-1', context, makeConfig({ id: 'cfg-b' }));
      await execute(`update ${TABLE} set config_data = 'not json' where config_id = 'cfg-a'`);

      const loaded = await store.load('task-1', context);
      expect(loaded.map((config) => config.id)).toEqual(['cfg-b']);
    });

    it('does not let a mutated result reach the next loadWithMetadata', async () => {
      const context = makeContext();
      await store.save('task-1', context, makeConfig());

      const first = await store.loadWithMetadata('task-1', context);
      first[0].config.url = 'https://attacker.test/';

      const [second] = await store.loadWithMetadata('task-1', context);
      expect(second.config.url).toBe('http://example.test/webhook');
    });
  });

  describe('delete()', () => {
    it('removes the named config and leaves the others', async () => {
      const context = makeContext();
      await store.save('task-1', context, makeConfig({ id: 'cfg-a' }));
      await store.save('task-1', context, makeConfig({ id: 'cfg-b' }));

      await store.delete('task-1', context, 'cfg-a');

      expect((await store.load('task-1', context)).map((config) => config.id)).toEqual(['cfg-b']);
    });

    it('refuses to guess when no config id is given', async () => {
      await expect(store.delete('task-1', makeContext(), undefined)).rejects.toThrow(
        /needs its configId/
      );
    });

    it('is a no-op for a config that is not there', async () => {
      const context = makeContext();
      await store.save('task-1', context, makeConfig());

      await store.delete('task-1', context, 'cfg-absent');

      expect(await store.load('task-1', context)).toHaveLength(1);
    });
  });

  describe('scoping', () => {
    it('isolates configs between tenants', async () => {
      const acme = makeContext({ tenant: 'acme' });
      const globex = makeContext({ tenant: 'globex' });
      await store.save('task-1', acme, makeConfig());

      expect(await store.load('task-1', acme)).toHaveLength(1);
      expect(await store.load('task-1', globex)).toEqual([]);
    });

    // An absent tenant is the global bucket, which is a tenant like any other.
    it('isolates the global bucket from a named tenant', async () => {
      const untenanted = makeContext();
      const acme = makeContext({ tenant: 'acme' });
      await store.save('task-1', untenanted, makeConfig({ url: 'https://global.test/' }));
      await store.save('task-1', acme, makeConfig({ url: 'https://acme.test/' }));

      expect(await rowsInTable()).toHaveLength(2);
      expect((await store.load('task-1', untenanted))[0].url).toBe('https://global.test/');
      expect((await store.load('task-1', acme))[0].url).toBe('https://acme.test/');
    });

    it('allows the same task and config id in different tenants', async () => {
      const acme = makeContext({ tenant: 'acme' });
      const globex = makeContext({ tenant: 'globex' });
      await store.save('task-1', acme, makeConfig({ url: 'https://acme.test/' }));
      await store.save('task-1', globex, makeConfig({ url: 'https://globex.test/' }));

      expect((await store.load('task-1', acme))[0].url).toBe('https://acme.test/');
      expect((await store.load('task-1', globex))[0].url).toBe('https://globex.test/');
    });

    it('isolates configs between owners in one tenant', async () => {
      const alice = makeContext({ tenant: 'acme', user: 'alice' });
      const bob = makeContext({ tenant: 'acme', user: 'bob' });
      await store.save('task-1', alice, makeConfig());

      expect(await store.load('task-1', alice)).toHaveLength(1);
      expect(await store.load('task-1', bob)).toEqual([]);
    });

    it('isolates configs between owners with no tenant', async () => {
      const alice = makeContext({ user: 'alice' });
      const bob = makeContext({ user: 'bob' });
      await store.save('task-1', alice, makeConfig());

      expect(await store.load('task-1', alice)).toHaveLength(1);
      expect(await store.load('task-1', bob)).toEqual([]);
    });

    it('allows the same task and config id for different owners', async () => {
      const alice = makeContext({ user: 'alice' });
      const bob = makeContext({ user: 'bob' });
      await store.save('task-1', alice, makeConfig({ url: 'https://alice.test/' }));
      await store.save('task-1', bob, makeConfig({ url: 'https://bob.test/' }));

      expect(await rowsInTable()).toHaveLength(2);
      expect((await store.load('task-1', alice))[0].url).toBe('https://alice.test/');
      expect((await store.load('task-1', bob))[0].url).toBe('https://bob.test/');
    });

    it('does not delete across tenants', async () => {
      const acme = makeContext({ tenant: 'acme' });
      const globex = makeContext({ tenant: 'globex' });
      await store.save('task-1', acme, makeConfig());
      await store.save('task-1', globex, makeConfig());

      await store.delete('task-1', globex, 'cfg-1');

      expect(await store.load('task-1', acme)).toHaveLength(1);
      expect(await store.load('task-1', globex)).toEqual([]);
    });

    it('does not delete across owners', async () => {
      const alice = makeContext({ user: 'alice' });
      const bob = makeContext({ user: 'bob' });
      await store.save('task-1', alice, makeConfig());

      await store.delete('task-1', bob, 'cfg-1');

      expect(await store.load('task-1', alice)).toHaveLength(1);
    });

    it('files an anonymous caller under the shared unknown owner', async () => {
      await store.save('task-1', makeContext(), makeConfig());

      expect(String((await rowsInTable())[0].owner)).toBe('unknown');
    });

    it('files a tenantless caller under the global bucket', async () => {
      await store.save('task-1', makeContext(), makeConfig());

      expect(String((await rowsInTable())[0].tenant)).toBe('');
    });

    it('honours a custom OwnerResolver', async () => {
      const byTenant = new DatabasePushNotificationStore(harness.db(), {
        ownerResolver: (context) => context.tenant ?? 'none',
      });
      const acme = makeContext({ tenant: 'acme', user: 'alice' });
      const acmeOther = makeContext({ tenant: 'acme', user: 'bob' });

      await byTenant.save('task-1', acme, makeConfig());

      // Different users, same resolved owner, so bob sees alice's config.
      expect(await byTenant.load('task-1', acmeOther)).toHaveLength(1);
      expect(String((await rowsInTable())[0].owner)).toBe('acme');
    });

    it('keeps owners and tenants that differ only in case apart', async () => {
      const lower = makeContext({ tenant: 'acme', user: 'alice' });
      const upper = makeContext({ tenant: 'ACME', user: 'Alice' });
      await store.save('task-1', lower, makeConfig({ url: 'https://lower.test/' }));
      await store.save('task-1', upper, makeConfig({ url: 'https://upper.test/' }));

      expect(await rowsInTable()).toHaveLength(2);
      expect((await store.load('task-1', lower))[0].url).toBe('https://lower.test/');
      expect((await store.load('task-1', upper))[0].url).toBe('https://upper.test/');
    });
  });

  describe('tableName', () => {
    const context = () => makeContext({ tenant: 'acme', user: 'alice' });

    it('reads and writes the table it was given', async () => {
      await harness.migrateRenamed();
      const renamed = new DatabasePushNotificationStore(harness.db(), { tableName: RENAMED_TABLE });

      await renamed.save('task-1', context(), makeConfig({ url: 'https://renamed.test/' }));

      expect((await renamed.load('task-1', context()))[0].url).toBe('https://renamed.test/');
      expect(await rowsInTable(RENAMED_TABLE)).toHaveLength(1);
    });

    it('a store left on the default name cannot read a renamed table', async () => {
      await harness.migrateRenamed();

      await expect(store.load('task-1', context())).rejects.toThrow();
    });

    it('a store given a name cannot read the default table', async () => {
      const renamed = new DatabasePushNotificationStore(harness.db(), { tableName: RENAMED_TABLE });

      await expect(renamed.load('task-1', context())).rejects.toThrow();
    });
  });
}

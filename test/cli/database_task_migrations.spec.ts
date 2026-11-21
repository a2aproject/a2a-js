import { beforeEach, expect, it } from 'vitest';
import { sql } from 'kysely';
import { run } from '../../src/cli/run.js';
import { migrateStore } from '../../src/cli/migrator.js';
import { taskStoreMigrations } from '../../src/cli/task/migrations.js';
import { DatabaseTaskStore } from '../../src/server/database/task/store.js';
import { ServerCallContext } from '../../src/server/context.js';
import { ListTasksRequest } from '../../src/types/index.js';
import {
  describeOnEachEngine,
  freshSqliteUrl,
  urlOnly,
  withConnection,
} from '../support/database/node_engines.js';

import { describeStoreMigrations } from '../support/database/store_migrations_behavior.js';

// Spelled out rather than imported from the store: a test that reads these from the code
// it checks cannot catch a rename, and a renamed ledger makes a migrated database look
// untouched.
const KEY_COLUMNS = ['tenant', 'owner', 'id'];

describeStoreMigrations({
  title: 'task',
  id: 'tasks',
  table: 'tasks',
  ledgerTable: 'a2a_tasks_migrations',
  migration: '0001_create_tasks',
  migrations: ['0001_create_tasks', '0002_timestamp_precision'],
  tableNameFlag: '--tasks-table-name',
  keyColumns: KEY_COLUMNS,
  allColumns: [
    ...KEY_COLUMNS,
    'context_id',
    'status_last_updated',
    'status_last_updated_nanos',
    'status_state',
    'status',
    'artifacts',
    'history',
    'metadata',
    'protocol_version',
  ],
  notNullColumns: [
    ...KEY_COLUMNS,
    'context_id',
    'status_last_updated',
    'status_last_updated_nanos',
  ],
  nullableColumns: [
    'status_state',
    'status',
    'artifacts',
    'history',
    'metadata',
    'protocol_version',
  ],
  widths: { tenant: 255, owner: 255, id: 36, context_id: 36, status_state: 255 },
  collatedColumns: [...KEY_COLUMNS, 'context_id', 'status_state'],
  // The listing indexes, and the column order the keyset pagination depends on.
  indexes: {
    tasks_scope_updated_idx: [
      'tenant',
      'owner',
      'status_last_updated',
      'status_last_updated_nanos',
      'id',
    ],
    tasks_scope_context_updated_idx: [
      'tenant',
      'owner',
      'context_id',
      'status_last_updated',
      'status_last_updated_nanos',
      'id',
    ],
  },
  renamedTable: 'agent_tasks',
  renamedLedgerTable: 'a2a_agent_tasks_migrations',
  secondTable: 'other_tasks',
  secondLedgerTable: 'a2a_other_tasks_migrations',
  otherStoreTables: ['push_notification_configs', 'a2a_push_notification_configs_migrations'],
  sqlitePrefix: 'a2a-task-migrations-',
});

const TABLE = 'tasks';
const RENAMED_TABLE = 'agent_tasks';
const STORE_ID = 'tasks';
const MIGRATION = '0001_create_tasks';

describeOnEachEngine(
  'task timestamp precision migration',
  { name: 'sqlite', freshUrl: freshSqliteUrl('a2a-task-precision-') },
  urlOnly,
  (engine) => {
    let url: string;
    const introspect = <T>(read: (db: import('kysely').Kysely<unknown>) => Promise<T>) =>
      withConnection(url, read);
    beforeEach(async () => {
      url = engine.freshUrl();
      await introspect(async (db) => {
        for (const table of [
          TABLE,
          RENAMED_TABLE,
          'a2a_tasks_migrations',
          'a2a_agent_tasks_migrations',
          'a2a_migrations_lock',
        ]) {
          await sql.raw(`drop table if exists ${table}`).execute(db);
        }
      });
    });
    async function cli(...args: string[]) {
      const out: string[] = [];
      const code = await run(
        [...args, '--url', url],
        {},
        { log: (...parts) => out.push(parts.join(' ')), error: () => {} }
      );
      return { code, out: out.join('\n') };
    }
    async function renderAndApply(...args: string[]) {
      const { code, out } = await cli(
        ...args,
        '--sql',
        '--dialect',
        engine.name,
        '--store',
        STORE_ID
      );
      expect(code).toBe(0);
      const statements = (out.match(/(?:\$\$[\s\S]*?\$\$|[^;])+/g) ?? [])
        .map((statement) => statement.trim())
        .filter(Boolean);
      await introspect(async (db) => {
        for (const statement of statements) await sql.raw(statement).execute(db);
      });
    }
    it('downgrade removes only precision metadata and preserves the task table', async () => {
      expect((await cli('upgrade', '--store', STORE_ID)).code).toBe(0);
      const result = await cli('downgrade', '--store', STORE_ID);
      expect(result.code).toBe(0);
      expect(result.out).toContain('reverted 0002_timestamp_precision');
      const tables = await introspect((db) => db.introspection.getTables());
      const taskTable = tables.find((table) => table.name === TABLE);
      expect(taskTable).toBeDefined();
      expect(taskTable?.columns.map((column) => column.name)).not.toContain(
        'status_last_updated_nanos'
      );
    });

    it.each([
      { table: TABLE, source: 'online' },
      { table: RENAMED_TABLE, source: 'online' },
      { table: TABLE, source: 'script' },
      { table: RENAMED_TABLE, source: 'script' },
    ])(
      'backfills existing $table rows using $source SQL without changing payloads',
      async ({ table, source }) => {
        const oldStore = taskStoreMigrations(table);
        await introspect((db) =>
          migrateStore(db, {
            ...oldStore,
            migrations: { [MIGRATION]: oldStore.migrations[MIGRATION] },
          })
        );
        const entries: readonly (readonly [string, string | undefined, number])[] = [
          ['a-newer', '2026-10-02T00:00:00.000900001Z', 900001],
          ['z-older', '2026-10-02T00:00:00.0001Z', 100000],
          ['tie-z', '2026-10-02T01:00:00.000900001+01:00', 900001],
          ['tie-y', '2026-10-01T19:00:00.000900001-05:00', 900001],
          ['pre-epoch', '1969-12-31T23:59:59.999900001Z', 900001],
          ['epoch', '1970-01-01T00:00:00.000000001Z', 1],
          ['epoch-offset', '1969-12-31T19:00:00.000000009-05:00', 9],
          ['invalid', 'xxxx-xx-xxTxx:xx:xx.000900001Z', 0],
          ['invalid-month', '2026-99-02T00:00:00.000900001Z', 0],
          ['whole-second', '2026-10-01T00:00:00Z', 0],
          ['no-timestamp', undefined, 0],
        ] as const;
        await introspect(async (db) => {
          for (const [id, timestamp] of entries) {
            const status = JSON.stringify({ state: 'TASK_STATE_WORKING', timestamp });
            const parsed = timestamp ? Date.parse(timestamp) : 0;
            const updated = Number.isNaN(parsed) ? 0 : parsed;
            for (const tenant of ['acme', 'other']) {
              await sql`insert into ${sql.table(table)}
              (tenant, owner, id, context_id, status_last_updated, status, metadata)
              values (${tenant}, 'unknown', ${id}, 'ctx', ${updated}, ${status}, '{"note":"keep"}')`.execute(
                db
              );
            }
          }
          await sql`insert into ${sql.table(table)}
          (tenant, owner, id, context_id, status_last_updated, status)
          values ('acme', 'unknown', 'unreadable', 'ctx', 0, 'not json'),
                 ('acme', 'unknown', 'null-status', 'ctx', 0, null)`.execute(db);
        });
        const rows = () =>
          introspect(
            async (db) =>
              (await sql`select * from ${sql.table(table)} order by tenant, owner, id`.execute(db))
                .rows as Record<string, unknown>[]
          );
        const before = await rows();
        if (source === 'online') {
          expect(
            (await cli('upgrade', '--store', STORE_ID, '--tasks-table-name', table)).code
          ).toBe(0);
        } else {
          await renderAndApply('upgrade', '--from', MIGRATION, '--tasks-table-name', table);
        }
        const after = await rows();
        expect(after.map(({ status_last_updated_nanos: _nanos, ...row }) => row)).toEqual(before);
        for (const [id, , nanos] of entries) {
          expect(
            after.filter((row) => row.id === id).map((row) => Number(row.status_last_updated_nanos))
          ).toEqual([nanos, nanos]);
        }
        expect(after.find((row) => row.id === 'unreadable')?.status_last_updated_nanos).toBe(0);
        expect(after.find((row) => row.id === 'null-status')?.status_last_updated_nanos).toBe(0);
        const seen: string[] = [];
        await introspect(async (db) => {
          const store = new DatabaseTaskStore(db, { tableName: table });
          const context = new ServerCallContext({ tenant: 'other' });
          let pageToken = '';
          for (let page = 0; page < entries.length + 1; page++) {
            const response = await store.list(
              ListTasksRequest.fromJSON({ pageSize: 1, pageToken }),
              context
            );
            seen.push(...response.tasks.map((task) => task.id));
            pageToken = response.nextPageToken;
            if (!pageToken) break;
          }
          expect(pageToken).toBe('');
        });
        expect(seen).toEqual([
          'tie-z',
          'tie-y',
          'a-newer',
          'z-older',
          'whole-second',
          'epoch-offset',
          'epoch',
          'no-timestamp',
          'invalid-month',
          'invalid',
          'pre-epoch',
        ]);
        // Downgrade only drops the derived column; upgrading recovers the same precision.
        expect(
          (await cli('downgrade', MIGRATION, '--store', STORE_ID, '--tasks-table-name', table)).code
        ).toBe(0);
        expect(await rows()).toEqual(before);
        expect((await cli('upgrade', '--store', STORE_ID, '--tasks-table-name', table)).code).toBe(
          0
        );
        expect(await rows()).toEqual(after);
      }
    );
  }
);

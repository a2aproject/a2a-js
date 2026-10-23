import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';

import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';

import { DatabaseTaskStore } from '../../src/server/database/task/store.js';
import { makeContext, makeListRequest } from '../support/database/builders.js';

import { taskStoreMigrations } from '../../src/cli/task/migrations.js';
import {
  RENAMED_TABLE,
  describeDatabaseTaskStoreBehavior,
} from '../support/database/database_task_store_behavior.js';

// Spelled out rather than imported from the store
const TABLE = 'tasks';

/** There is no URL to connect to: the binding *is* the database. */
function open(): Kysely<unknown> {
  return new Kysely<unknown>({ dialect: new D1Dialect({ database: env.TASKS_DB }) });
}

describe('DatabaseTaskStore on D1', () => {
  let db: Kysely<unknown>;

  /** No ledger and no lock table here: nothing on edge runs the `Migrator`. */
  async function dropEverything(connection: Kysely<unknown>): Promise<void> {
    for (const table of [TABLE, RENAMED_TABLE]) {
      await sql.raw(`drop table if exists ${table}`).execute(connection);
    }
  }

  /**
   * D1 is SQLite, so the schema comes from the migrations Node runs, in name order.
   * The `Migrator` cannot: it introspects with `pragma_table_info`, which D1 answers
   * with SQLITE_AUTH.
   */
  async function migrate(connection: Kysely<unknown>, tableName?: string): Promise<void> {
    const { migrations } = taskStoreMigrations(tableName);
    for (const name of Object.keys(migrations).sort()) {
      await migrations[name].up(connection);
    }
  }

  beforeEach(async () => {
    const connection = open();
    await dropEverything(connection);
    await migrate(connection);
    await connection.destroy();

    db = open();
  });

  it('backfills existing D1 rows while preserving payloads and scope', async () => {
    await dropEverything(db);
    const { migrations } = taskStoreMigrations();
    await migrations['0001_create_tasks'].up(db);
    for (const [id, timestamp] of [
      ['a-newer', '2026-10-02T01:00:00.000900001+01:00'],
      ['z-older', '2026-10-02T00:00:00.000100Z'],
    ]) {
      const status = JSON.stringify({ state: 'TASK_STATE_WORKING', timestamp });
      for (const tenant of ['acme', 'other']) {
        await sql`insert into tasks (tenant, owner, id, context_id, status_last_updated, status)
          values (${tenant}, 'alice', ${id}, 'ctx', ${Date.parse(timestamp)}, ${status})`.execute(
          db
        );
      }
    }
    await sql`insert into tasks (tenant, owner, id, context_id, status_last_updated, status)
      values ('other', 'alice', 'unreadable', 'ctx', 0, 'not json'),
             ('other', 'alice', 'null-status', 'ctx', 0, null)`.execute(db);
    for (const [id, timestamp] of [
      ['invalid', 'xxxx-xx-xxTxx:xx:xx.000900001Z'],
      ['invalid-month', '2026-99-02T00:00:00.000900001Z'],
      ['epoch-offset', '1969-12-31T19:00:00.000000009-05:00'],
    ]) {
      const status = JSON.stringify({ state: 'TASK_STATE_WORKING', timestamp });
      await sql`insert into tasks (tenant, owner, id, context_id, status_last_updated, status)
        values ('other', 'alice', ${id}, 'ctx', 0, ${status})`.execute(db);
    }
    const before = (await sql`select * from tasks`.execute(db)).rows as Record<string, unknown>[];
    await migrations['0002_timestamp_precision'].up(db);
    const after = (await sql`select * from tasks`.execute(db)).rows as Record<string, unknown>[];
    expect(after.map(({ status_last_updated_nanos: _nanos, ...row }) => row)).toEqual(before);
    expect(
      after.filter((row) => row.id === 'a-newer').map((row) => row.status_last_updated_nanos)
    ).toEqual([900001, 900001]);
    expect(
      after.filter((row) => row.id === 'z-older').map((row) => row.status_last_updated_nanos)
    ).toEqual([100000, 100000]);
    expect(after.find((row) => row.id === 'unreadable')?.status_last_updated_nanos).toBe(0);
    expect(after.find((row) => row.id === 'null-status')?.status_last_updated_nanos).toBe(0);
    expect(after.find((row) => row.id === 'invalid')?.status_last_updated_nanos).toBe(0);
    expect(after.find((row) => row.id === 'invalid-month')?.status_last_updated_nanos).toBe(0);
    expect(after.find((row) => row.id === 'epoch-offset')?.status_last_updated_nanos).toBe(9);
    const context = makeContext({ tenant: 'acme', user: 'alice' });
    const store = new DatabaseTaskStore(db);
    const first = await store.list(makeListRequest({ pageSize: 1 }), context);
    expect(first.tasks.map((task) => task.id)).toEqual(['a-newer']);
    const second = await store.list(
      makeListRequest({ pageSize: 1, pageToken: first.nextPageToken }),
      context
    );
    expect(second.tasks.map((task) => task.id)).toEqual(['z-older']);
    expect(second.nextPageToken).toBe('');
  });

  describeDatabaseTaskStoreBehavior({
    db: () => db,
    async reconnect() {
      await db.destroy();
      db = open();
      return db;
    },
    async execute(text) {
      await sql.raw(text).execute(db);
    },
    async rowsInTable(table = TABLE) {
      return (await sql.raw(`select * from ${table}`).execute(db)).rows as Record<
        string,
        unknown
      >[];
    },
    async migrateRenamed() {
      await sql.raw(`drop table if exists ${TABLE}`).execute(db);
      await migrate(db, RENAMED_TABLE);
    },
  });
});

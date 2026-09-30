/// <reference types="@cloudflare/vitest-pool-workers" />
import { beforeEach, describe } from 'vitest';
import { env } from 'cloudflare:test';
import type { D1Database } from '@cloudflare/workers-types';

import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';

import { taskStoreMigrations } from '../../src/cli/task/migrations.js';
import { describeDatabaseTaskStoreBehavior } from '../support/database/database_task_store_behavior.js';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    TASKS_DB: D1Database;
  }
}

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
    await sql.raw(`drop table if exists ${TABLE}`).execute(connection);
  }

  /**
   * D1 is SQLite, so the schema comes from the migrations Node runs, in name order.
   * The `Migrator` cannot: it introspects with `pragma_table_info`, which D1 answers
   * with SQLITE_AUTH.
   */
  async function migrate(connection: Kysely<unknown>): Promise<void> {
    const { migrations } = taskStoreMigrations();
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
    async rowsInTable() {
      return (await sql.raw(`select * from ${TABLE}`).execute(db)).rows as Record<
        string,
        unknown
      >[];
    },
  });
});

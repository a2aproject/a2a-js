import { afterEach, beforeEach } from 'vitest';

import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { connect } from '../../src/cli/connect.js';
import { migrateStore } from '../../src/cli/migrator.js';
import { taskStoreMigrations } from '../../src/cli/task/migrations.js';
import {
  describeOnEachEngine,
  freshSqliteUrl,
  urlOnly,
  withConnection,
} from '../support/database/node_engines.js';
import {
  RENAMED_LEDGER_TABLE,
  RENAMED_TABLE,
  describeDatabaseTaskStoreBehavior,
} from '../support/database/database_task_store_behavior.js';

// Spelled out rather than imported from the store
const TABLE = 'tasks';
const LEDGER_TABLE = 'a2a_tasks_migrations';
const LOCK_TABLE = 'a2a_migrations_lock';

describeOnEachEngine(
  'DatabaseTaskStore',
  { name: 'sqlite', freshUrl: freshSqliteUrl('a2a-task-store-') },
  urlOnly,
  (engine) => {
    let url: string;
    let db: Kysely<unknown>;

    async function migrate(): Promise<void> {
      await withConnection(url, (connection) => migrateStore(connection, taskStoreMigrations()));
    }

    /** The ledger goes too, or a re-migration finds 0001 applied and builds nothing. */
    async function dropEverything(): Promise<void> {
      await withConnection(url, async (connection) => {
        for (const table of [
          TABLE,
          LEDGER_TABLE,
          LOCK_TABLE,
          RENAMED_TABLE,
          RENAMED_LEDGER_TABLE,
        ]) {
          await sql.raw(`drop table if exists ${table}`).execute(connection);
        }
      });
    }

    beforeEach(async () => {
      url = engine.freshUrl();
      // SQLite gets a new file each time; the shared servers need the last run cleared.
      await dropEverything();
      await migrate();
      db = await connect(url);
    });

    afterEach(async () => {
      await db?.destroy();
    });

    describeDatabaseTaskStoreBehavior({
      db: () => db,
      async reconnect() {
        await db.destroy();
        db = await connect(url);
        return db;
      },
      execute: (text) =>
        withConnection(url, async (connection) => {
          await sql.raw(text).execute(connection);
        }),
      rowsInTable: (table = TABLE) =>
        withConnection(
          url,
          async (connection) =>
            (await sql.raw(`select * from ${table}`).execute(connection)).rows as Record<
              string,
              unknown
            >[]
        ),
      async migrateRenamed() {
        await withConnection(url, async (connection) => {
          for (const table of [TABLE, LEDGER_TABLE]) {
            await sql.raw(`drop table if exists ${table}`).execute(connection);
          }
          await migrateStore(connection, taskStoreMigrations(RENAMED_TABLE));
        });
      },
    });
  }
);

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { connect } from '../../src/cli/connect.js';
import { migrateStore } from '../../src/cli/migrator.js';
import { pushNotificationStoreMigrations } from '../../src/cli/push_notification/migrations.js';
import { DatabasePushNotificationStore } from '../../src/server/database/push_notification/store.js';
import {
  describeOnEachEngine,
  freshSqliteUrl,
  urlOnly,
  withConnection,
} from '../support/database/node_engines.js';
import { makeConfig, makeContext } from '../support/database/builders.js';
import { describeDatabasePushNotificationStoreBehavior } from '../support/database/database_push_notification_store_behavior.js';

// Spelled out rather than imported from the store
const TABLE = 'push_notification_configs';
const LEDGER_TABLE = 'a2a_push_notification_configs_migrations';
const LOCK_TABLE = 'a2a_migrations_lock';

/** What a deployment that renamed the table would have instead, ledger included. */
const RENAMED_TABLE = 'agent_push_configs';
const RENAMED_LEDGER_TABLE = 'a2a_agent_push_configs_migrations';

describeOnEachEngine(
  'DatabasePushNotificationStore',
  { name: 'sqlite', freshUrl: freshSqliteUrl('a2a-push-store-') },
  urlOnly,
  (engine) => {
    let url: string;
    let db: Kysely<unknown>;
    let store: DatabasePushNotificationStore;

    async function migrate(): Promise<void> {
      await withConnection(url, (connection) =>
        migrateStore(connection, pushNotificationStoreMigrations())
      );
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
      // For the tableName tests below; the shared ones build their own.
      store = new DatabasePushNotificationStore(db);
    });

    afterEach(async () => {
      await db?.destroy();
    });

    describeDatabasePushNotificationStoreBehavior({
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
      rowsInTable: () =>
        withConnection(
          url,
          async (connection) =>
            (await sql.raw(`select * from ${TABLE}`).execute(connection)).rows as Record<
              string,
              unknown
            >[]
        ),
    });

    describe('tableName', () => {
      const context = () => makeContext({ tenant: 'acme', user: 'alice' });

      /**
       * The outer setup migrated the default table, so a test that needs the renamed one
       * has to swap it. Tests that want the default simply do not call this.
       */
      async function migrateRenamedOnly(): Promise<void> {
        await withConnection(url, async (connection) => {
          for (const table of [TABLE, LEDGER_TABLE]) {
            await sql.raw(`drop table if exists ${table}`).execute(connection);
          }
          await migrateStore(connection, pushNotificationStoreMigrations(RENAMED_TABLE));
        });
      }

      it('reads and writes the table it was given', async () => {
        await migrateRenamedOnly();
        const renamed = new DatabasePushNotificationStore(db, { tableName: RENAMED_TABLE });

        await renamed.save('task-1', context(), makeConfig({ url: 'https://renamed.test/' }));

        expect((await renamed.load('task-1', context()))[0].url).toBe('https://renamed.test/');
        const rows = await withConnection(
          url,
          async (connection) =>
            (await sql.raw(`select * from ${RENAMED_TABLE}`).execute(connection)).rows
        );
        expect(rows).toHaveLength(1);
      });

      it('a store left on the default name cannot read a renamed table', async () => {
        await migrateRenamedOnly();

        await expect(store.load('task-1', context())).rejects.toThrow();
      });

      it('a store given a name cannot read the default table', async () => {
        const renamed = new DatabasePushNotificationStore(db, { tableName: RENAMED_TABLE });

        await expect(renamed.load('task-1', context())).rejects.toThrow();
      });
    });
  }
);

import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { dialectOf, type DialectName } from '../../dialect.js';
import type { MigrationModule } from '../../store_migrations.js';

/**
 * Frozen in time so it imports no table definition and spells
 * every name and type out.
 *
 * `dialectOf` is the one exception: it only names the engine, and cannot change what
 * gets created. The collation strings can, so they are frozen here rather than shared.
 */
const COLLATION: Readonly<Record<DialectName, string>> = {
  postgres: 'collate "C"',
  mysql: 'collate utf8mb4_0900_bin',
  sqlite: 'collate binary',
};

/**
 * The `CREATE TABLE`.
 */
function tableStatement<DB>(db: Kysely<DB>, tableName: string) {
  const collation = COLLATION[dialectOf(db)];
  const collatedVarchar255 = sql.raw(`varchar(255) ${collation}`);
  const collatedVarchar36 = sql.raw(`varchar(36) ${collation}`);

  return db.schema
    .createTable(tableName)
    .addColumn('tenant', collatedVarchar255, (column) => column.notNull())
    .addColumn('owner', collatedVarchar255, (column) => column.notNull())
    .addColumn('task_id', collatedVarchar36, (column) => column.notNull())
    .addColumn('config_id', collatedVarchar36, (column) => column.notNull())
    .addColumn('config_data', 'text')
    .addColumn('protocol_version', 'varchar(255)')
    .addPrimaryKeyConstraint(`${tableName}_pkey`, ['tenant', 'owner', 'task_id', 'config_id']);
}

/**
 * The table's name is an argument because Kysely hands a migration nothing but the
 * connection.
 */
export function createPushNotificationConfigs(tableName: string): MigrationModule {
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await tableStatement(db, tableName).execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      await db.schema.dropTable(tableName).ifExists().execute();
    },
  };
}

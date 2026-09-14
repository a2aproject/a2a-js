import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { dialectOf, type DialectName } from '../../dialect.js';

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
function tableStatement<DB>(db: Kysely<DB>) {
  const collation = COLLATION[dialectOf(db)];
  const collatedVarchar255 = sql.raw(`varchar(255) ${collation}`);
  const collatedVarchar36 = sql.raw(`varchar(36) ${collation}`);

  return db.schema
    .createTable('push_notification_configs')
    .addColumn('tenant', collatedVarchar255, (column) => column.notNull())
    .addColumn('owner', collatedVarchar255, (column) => column.notNull())
    .addColumn('task_id', collatedVarchar36, (column) => column.notNull())
    .addColumn('config_id', collatedVarchar36, (column) => column.notNull())
    .addColumn('config_data', 'text')
    .addColumn('protocol_version', 'varchar(255)')
    .addPrimaryKeyConstraint('push_notification_configs_pkey', [
      'tenant',
      'owner',
      'task_id',
      'config_id',
    ]);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await tableStatement(db).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('push_notification_configs').ifExists().execute();
}

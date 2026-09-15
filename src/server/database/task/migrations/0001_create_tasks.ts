import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { dialectOf, type DialectName } from '../../dialect.js';

/**
 * Frozen in time so it imports no table definition and spells
 * every name and type out.
 *
 * `dialectOf` is the one exception: it only names the engine, and cannot change what
 * gets created. The strings it selects can, so they are frozen here rather than shared.
 */
const COLLATION: Readonly<Record<DialectName, string>> = {
  postgres: 'collate "C"',
  mysql: 'collate utf8mb4_0900_bin',
  sqlite: 'collate binary',
};

/**
 * MySQL's `text` holds 65,535 bytes, which artifacts and history outgrow.
 */
const PAYLOAD: Readonly<Record<DialectName, string>> = {
  postgres: 'text',
  mysql: 'longtext',
  sqlite: 'text',
};

/**
 * The `CREATE TABLE`.
 */
function tableStatement<DB>(db: Kysely<DB>) {
  const dialect = dialectOf(db);
  const collation = COLLATION[dialect];
  const collatedVarchar255 = sql.raw(`varchar(255) ${collation}`);
  const collatedVarchar36 = sql.raw(`varchar(36) ${collation}`);
  const payload = sql.raw(PAYLOAD[dialect]);

  return db.schema
    .createTable('tasks')
    .addColumn('tenant', collatedVarchar255, (column) => column.notNull())
    .addColumn('owner', collatedVarchar255, (column) => column.notNull())
    .addColumn('id', collatedVarchar36, (column) => column.notNull())
    .addColumn('context_id', collatedVarchar36, (column) => column.notNull())
    .addColumn('status_last_updated', 'bigint', (column) => column.notNull())
    .addColumn('status_state', collatedVarchar255)
    .addColumn('status', payload)
    .addColumn('artifacts', payload)
    .addColumn('history', payload)
    .addColumn('metadata', payload)
    .addColumn('protocol_version', 'varchar(255)')
    .addPrimaryKeyConstraint('tasks_pkey', ['tenant', 'owner', 'id']);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await tableStatement(db).execute();

  await db.schema
    .createIndex('tasks_scope_updated_idx')
    .on('tasks')
    .columns(['tenant', 'owner', 'status_last_updated', 'id'])
    .execute();

  await db.schema
    .createIndex('tasks_scope_context_updated_idx')
    .on('tasks')
    .columns(['tenant', 'owner', 'context_id', 'status_last_updated', 'id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('tasks').ifExists().execute();
}

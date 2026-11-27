import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { dialectOf, type DialectName } from '../../../server/database/dialect.js';
import type { MigrationModule } from '../../store_migrations.js';

/**
 * MySQL's `text` holds 65,535 bytes, which timelines outgrow (same as `history`).
 * Frozen here rather than shared with `0001`.
 */
const PAYLOAD: Readonly<Record<DialectName, string>> = {
  postgres: 'text',
  mysql: 'longtext',
  sqlite: 'text',
};

/**
 * Adds the task `timeline` column (A2A v1.1). Nullable, so tasks stored before
 * it read as unset.
 */
export function addTaskTimeline(tableName: string): MigrationModule {
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      const payload = sql.raw(PAYLOAD[dialectOf(db)]);
      await db.schema.alterTable(tableName).addColumn('timeline', payload).execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      await db.schema.alterTable(tableName).dropColumn('timeline').execute();
    },
  };
}

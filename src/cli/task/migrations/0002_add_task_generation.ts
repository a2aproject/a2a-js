import type { Kysely } from 'kysely';

import type { MigrationModule } from '../../store_migrations.js';

/**
 * Adds the task `generation` (A2A v1.1). Nullable, so tasks stored before it
 * read as unset and start at 1 on their next change.
 *
 * Frozen in time like `0001`: it spells its column out rather than importing
 * the table definition.
 */
export function addTaskGeneration(tableName: string): MigrationModule {
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await db.schema.alterTable(tableName).addColumn('generation', 'bigint').execute();
    },

    async down(db: Kysely<unknown>): Promise<void> {
      await db.schema.alterTable(tableName).dropColumn('generation').execute();
    },
  };
}

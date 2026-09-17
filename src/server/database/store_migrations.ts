import type { Kysely } from 'kysely';

import { PUSH_NOTIFICATION_STORE_MIGRATIONS } from './push_notification/migrations.js';
import { TASK_STORE_MIGRATIONS } from './task/migrations.js';

/**
 * Structurally Kysely's own `Migration`. Declared here so nothing under `src/server`
 * imports `kysely/migration`.
 */
interface MigrationModule {
  up(db: Kysely<unknown>): Promise<void>;
  down?(db: Kysely<unknown>): Promise<void>;
}

/**
 * One store's migrations, and the ledger recording which have run.
 * Each store needs its own ledger.
 */
export interface StoreMigrations {
  /** Selects the store on the command line, and names it in output. */
  readonly id: string;
  /** Deliberately not Kysely's default `kysely_migration`. */
  readonly ledgerTable: string;
  /** Applied in name order, which is why the `0001_` prefix fixes the sequence. */
  readonly migrations: Readonly<Record<string, MigrationModule>>;
}

/**
 * Every store `a2a-db` manages.
 */
export const ALL_STORE_MIGRATIONS: readonly StoreMigrations[] = [
  PUSH_NOTIFICATION_STORE_MIGRATIONS,
  TASK_STORE_MIGRATIONS,
];

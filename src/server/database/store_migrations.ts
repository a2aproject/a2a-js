import type { Kysely } from 'kysely';

/**
 * Structurally Kysely's own `Migration`. Declared here so nothing under `src/server`
 * imports `kysely/migration`.
 */
export interface MigrationModule {
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
 * PostgreSQL has the tightest identifier limit of the three engines, 63 characters, and
 * the longest thing a migration adds to the table name is the 26 of
 * `_scope_context_updated_idx`. That leaves 37.
 */
const MAX_TABLE_NAME_LENGTH = 37;

/**
 * Where Kysely records which of a store's migrations have run, derived from the table
 * they build.
 */
export function ledgerTableFor(tableName: string): string {
  if (tableName.length > MAX_TABLE_NAME_LENGTH) {
    throw new Error(
      `Table name "${tableName}" is too long: ${tableName.length} characters, against the ` +
        `${MAX_TABLE_NAME_LENGTH} that leave room for the names a migration derives from it.`
    );
  }

  return `a2a_${tableName}_migrations`;
}

import type { Kysely } from 'kysely';

/**
 * How a runtime hands the shared store tests its database. The caller's `beforeEach`
 * leaves a migrated, otherwise empty database behind `db()`.
 */
export interface StoreHarness {
  /** The connection the current test runs on. */
  db(): Kysely<unknown>;
  /** Closes that connection and opens another to the same database, as a restart would. */
  reconnect(): Promise<Kysely<unknown>>;
  execute(text: string): Promise<void>;
  /** Every row of the store's table, or of `table`. */
  rowsInTable(table?: string): Promise<Record<string, unknown>[]>;
  /**
   * Drops the default table and migrates the store's RENAMED_TABLE in its place. Fixed
   * rather than a parameter, so the cleanup always knows which renamed table to drop.
   */
  migrateRenamed(): Promise<void>;
}

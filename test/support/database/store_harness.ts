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
  /** Every row of the store's table. */
  rowsInTable(): Promise<Record<string, unknown>[]>;
}

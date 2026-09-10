import { Migrator } from 'kysely/migration';
import type { Kysely } from 'kysely';
import type { Migration, MigrationResultSet, NoMigrations } from 'kysely/migration';

/**
 * One store's migrations, and the ledger recording which have run.
 * Each store needs its own ledger.
 */
export interface StoreMigrations {
  /** Selects the store on the command line, and names it in output. */
  readonly id: string;
  /** Deliberately not Kysely's default `kysely_migration`. */
  readonly ledgerTable: string;
  /** Kysely takes the lock table's name separately. */
  readonly lockTable: string;
  /** Applied in name order, which is why the `0001_` prefix fixes the sequence. */
  readonly migrations: Readonly<Record<string, Migration>>;
}

/** Generic in `DB`, because Kysely's schema parameter is invariant. */
function migratorFor<DB>(db: Kysely<DB>, store: StoreMigrations) {
  return new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(store.migrations) },
    migrationTableName: store.ledgerTable,
    migrationLockTableName: store.lockTable,
  });
}

/** Kysely reports failure in the returned object; rethrow so it cannot be ignored. */
function throwOnFailure(store: StoreMigrations, result: MigrationResultSet): void {
  if (result.error === undefined) return;
  const failed = result.results?.find((entry) => entry.status === 'Error');
  const where = failed ? ` in migration "${failed.migrationName}"` : '';
  throw new Error(`store "${store.id}" migration failed${where}: ${String(result.error)}`, {
    cause: result.error,
  });
}

/** One migration, and when it ran. `executedAt` is undefined while it is still pending. */
export interface MigrationState {
  readonly name: string;
  readonly executedAt?: Date;
}

/**
 * What the ledger says, without changing it. A ledger table that does not exist yet
 * reads as every migration pending, rather than being created.
 */
export async function storeState<DB>(
  db: Kysely<DB>,
  store: StoreMigrations
): Promise<readonly MigrationState[]> {
  const migrations = await migratorFor(db, store).getMigrations();
  return migrations.map(({ name, executedAt }) => ({ name, executedAt }));
}

/** Applies every migration the ledger has not already recorded. */
export async function migrateStore<DB>(db: Kysely<DB>, store: StoreMigrations): Promise<void> {
  throwOnFailure(store, await migratorFor(db, store).migrateToLatest());
}

/** The revision name meaning "before any migration ran". */
export const BASE = 'base';

/**
 * Every migration this store knows, in the order they apply.
 */
export function migrationNames(store: StoreMigrations): string[] {
  return Object.keys(store.migrations).sort();
}

/** Migrates up or down until the ledger reads `target`. */
export async function migrateStoreTo<DB>(
  db: Kysely<DB>,
  store: StoreMigrations,
  target: string | NoMigrations
): Promise<void> {
  throwOnFailure(store, await migratorFor(db, store).migrateTo(target));
}

/**
 * Reverts the most recently applied migration, and names it. Resolves to `undefined`
 * when the ledger was already empty, which is a no-op rather than an error.
 */
export async function rollbackStore<DB>(
  db: Kysely<DB>,
  store: StoreMigrations
): Promise<string | undefined> {
  const result = await migratorFor(db, store).migrateDown();
  throwOnFailure(store, result);
  return result.results?.find((entry) => entry.status === 'Success')?.migrationName;
}

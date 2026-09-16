import type { Kysely } from 'kysely';
// Types only, so nothing here resolves at runtime. Kysely 0.28 has no such subpath,
// but these never reach an emitted declaration, because nothing public re-exports
// this module. Exporting one would break consumers on 0.28. The class itself is a
// value, so it is still loaded at runtime from whichever path kysely has.
import type {
  Migration,
  MigrationResultSet,
  Migrator,
  MigratorProps,
  NoMigrations,
} from 'kysely/migration';

/**
 * Shared by every store.
 */
const MIGRATION_LOCK_TABLE = 'a2a_migrations_lock';

type MigratorConstructor = new (props: MigratorProps) => Migrator;

/** The two runtime values this module needs, from whichever path exports them. */
interface LoadedMigration {
  readonly Migrator: MigratorConstructor;
  /** Kysely's own sentinel for "revert everything". */
  readonly NO_MIGRATIONS: NoMigrations;
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
  readonly migrations: Readonly<Record<string, Migration>>;
}

/**
 * Kept non-literal, so type-checking does not demand a subpath the installed kysely
 * may not have.
 */
async function loadModule(specifier: string): Promise<Record<string, unknown>> {
  return (await import(specifier)) as Record<string, unknown>;
}

let loaded: Promise<LoadedMigration> | undefined;

/** `kysely/migration` on 0.29 and later, the package root before that. */
function migrationModule(): Promise<LoadedMigration> {
  loaded ??= (async () => {
    for (const specifier of ['kysely/migration', 'kysely']) {
      let module: Record<string, unknown>;
      try {
        module = await loadModule(specifier);
      } catch {
        continue;
      }
      const migrator = module.Migrator;
      const noMigrations = module.NO_MIGRATIONS;
      if (typeof migrator === 'function' && typeof noMigrations === 'object' && noMigrations) {
        return {
          Migrator: migrator as MigratorConstructor,
          NO_MIGRATIONS: noMigrations as NoMigrations,
        };
      }
    }
    throw new Error(
      'This kysely exports no Migrator and NO_MIGRATIONS from either "kysely/migration" ' +
        'or "kysely". @a2a-js/sdk supports kysely 0.28 and later.'
    );
  })();
  return loaded;
}

/** Generic in `DB`, because Kysely's schema parameter is invariant. */
async function migratorFor<DB>(db: Kysely<DB>, store: StoreMigrations): Promise<Migrator> {
  const { Migrator } = await migrationModule();
  return new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(store.migrations) },
    migrationTableName: store.ledgerTable,
    migrationLockTableName: MIGRATION_LOCK_TABLE,
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
  const migrations = await (await migratorFor(db, store)).getMigrations();
  return migrations.map(({ name, executedAt }) => ({ name, executedAt }));
}

/** Applies every migration the ledger has not already recorded. */
export async function migrateStore<DB>(db: Kysely<DB>, store: StoreMigrations): Promise<void> {
  throwOnFailure(store, await (await migratorFor(db, store)).migrateToLatest());
}

/** The revision name meaning "before any migration ran". */
export const BASE = 'base';

/**
 * Every migration this store knows, in the order they apply.
 */
export function migrationNames(store: StoreMigrations): string[] {
  return Object.keys(store.migrations).sort();
}

/**
 * Migrates up or down until the ledger reads `target`, which is a migration name or
 * {@link BASE}. Kysely spells "revert everything" as its own sentinel.
 */
export async function migrateStoreTo<DB>(
  db: Kysely<DB>,
  store: StoreMigrations,
  target: string
): Promise<void> {
  const { NO_MIGRATIONS } = await migrationModule();
  const resolved = target === BASE ? NO_MIGRATIONS : target;
  throwOnFailure(store, await (await migratorFor(db, store)).migrateTo(resolved));
}

/**
 * Reverts the most recently applied migration, and names it. Resolves to `undefined`
 * when the ledger was already empty, which is a no-op rather than an error.
 */
export async function rollbackStore<DB>(
  db: Kysely<DB>,
  store: StoreMigrations
): Promise<string | undefined> {
  const result = await (await migratorFor(db, store)).migrateDown();
  throwOnFailure(store, result);
  return result.results?.find((entry) => entry.status === 'Success')?.migrationName;
}

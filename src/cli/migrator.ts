import type { Kysely } from 'kysely';
// Types only, so nothing here resolves at runtime; the classes themselves are loaded
// below from whichever path the installed kysely has. Kysely 0.28 exposes no
// `kysely/migration` subpath, which is safe here because `exports` carries no `./cli`
// entry: nothing in this directory can reach a consumer's declarations.
import type { MigrationResultSet, Migrator, MigratorProps, NoMigrations } from 'kysely/migration';

import type { StoreMigrations } from '../server/database/store_migrations.js';

/**
 * Shared by every store.
 */
export const MIGRATION_LOCK_TABLE = 'a2a_migrations_lock';

type MigratorConstructor = new (props: MigratorProps) => Migrator;

/** The two runtime values this module needs, from whichever path exports them. */
interface LoadedMigration {
  readonly Migrator: MigratorConstructor;
  /** Kysely's own sentinel for "revert everything". */
  readonly NO_MIGRATIONS: NoMigrations;
}

/**
 * Kept non-literal, so type-checking does not demand a subpath the installed kysely
 * may not have.
 */
async function loadModule(specifier: string): Promise<Record<string, unknown>> {
  return (await import(specifier)) as Record<string, unknown>;
}

let loaded: Promise<LoadedMigration> | undefined;

/** `kysely/migration` on 0.29 and later, the package root before that. Exported for tests. */
export function migrationModule(): Promise<LoadedMigration> {
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
 * Reverts migrations until the ledger reads `target`, which is a migration name that stays
 * applied or {@link BASE}. Kysely's `migrateTo` would apply migrations to reach a target that
 * is still pending, so only an applied target is accepted: a downgrade must never upgrade.
 * Kysely spells "revert everything" as its own sentinel.
 */
export async function revertStoreTo<DB>(
  db: Kysely<DB>,
  store: StoreMigrations,
  target: string
): Promise<void> {
  const migrator = await migratorFor(db, store);
  if (target !== BASE) {
    const applied = (await migrator.getMigrations()).some(
      (migration) => migration.name === target && migration.executedAt !== undefined
    );
    if (!applied) {
      throw new Error(
        `"${target}" is not applied to the ${store.id} store, so reaching it would move ` +
          `the store up, but this is a downgrade. Use upgrade to apply it.`
      );
    }
  }
  const { NO_MIGRATIONS } = await migrationModule();
  const resolved = target === BASE ? NO_MIGRATIONS : target;
  throwOnFailure(store, await migrator.migrateTo(resolved));
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

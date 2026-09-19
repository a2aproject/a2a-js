import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import type { DialectName } from '../server/database/dialect.js';
import type { StoreMigrations } from '../server/database/store_migrations.js';
import { BASE, migrationNames } from './migrator.js';
import { recordingKysely } from './offline.js';

/** The end of a store's history, as {@link BASE} is the start. */
export const LATEST = 'latest';

/**
 * Kysely's ledger row, restated so a script can write one without the migrator. The
 * shape is `Migrator`'s own, so a later online run reads back what the script inserted.
 */
interface LedgerRow {
  name: string;
  timestamp: string;
}

/** Every table this Kysely writes is a ledger; only the name differs per store. */
type LedgerDatabase = Record<string, LedgerRow>;

/**
 * Where a point in a store's history sits. {@link BASE} precedes everything.
 * {@link LATEST} is not one: it is where rendering ends, never where it starts.
 */
function positionOf(names: readonly string[], point: string): number {
  if (point === BASE) return -1;
  const at = names.indexOf(point);
  if (at === -1) {
    throw new Error(
      `"${point}" is not a migration. Expected "${BASE}" or one of: ${names.join(', ')}.`
    );
  }
  return at;
}

/** The migrations still to apply after `from`, in the order they apply. */
function span(store: StoreMigrations, from: string): string[] {
  const names = migrationNames(store);
  return names.slice(positionOf(names, from) + 1);
}

/**
 * Kysely's ledger table, which `Migrator` creates for itself and a script has to carry.
 *
 * The lock table is left out: it serialises concurrent migrators, which a script applied
 * once by hand is not, and a later online run creates it anyway.
 */
function createLedger(db: Kysely<LedgerDatabase>, store: StoreMigrations) {
  return db.schema
    .createTable(store.ledgerTable)
    .ifNotExists()
    .addColumn('name', 'varchar(255)', (column) => column.notNull().primaryKey())
    .addColumn('timestamp', 'varchar(255)', (column) => column.notNull());
}

/**
 * Every statement upgrading one store from `from` to its latest migration.
 *
 * The migrator cannot do this: it picks what to run by reading the ledger, and a script
 * has none to read. Naming the starting point makes the answer static, so the migrations
 * are driven directly and their ledger rows written alongside.
 */
async function storeStatements(
  dialect: DialectName,
  store: StoreMigrations,
  from: string
): Promise<string[]> {
  const names = span(store, from);
  if (names.length === 0) return [];

  const { db, recorded } = recordingKysely<LedgerDatabase>(dialect);
  // Migrations are written against the schema they create, which this one does not know.
  const target = db as Kysely<unknown>;

  try {
    if (from === BASE) await createLedger(db, store).execute();

    for (const name of names) {
      await store.migrations[name].up(target);
      // `Migrator` stamps when the migration ran. A script can only stamp when it was
      // written, which is what `a2a-db status` reports once it has been applied.
      await db
        .insertInto(store.ledgerTable)
        .values({ name: sql.lit(name), timestamp: sql.lit(new Date().toISOString()) })
        .execute();
    }
  } finally {
    await db.destroy();
  }

  return recorded.map((query) => `${query.sql};`);
}

/** What to render, and for which engine. */
export interface MigrationScript {
  readonly dialect: DialectName;
  readonly stores: readonly StoreMigrations[];
  /** Where the database already is, taken on trust. */
  readonly from: string;
}

/**
 * A script upgrading every selected store from `from` to its latest migration, for an
 * engine this CLI never connects to. No driver is loaded and nothing is read, so the
 * starting point is taken on trust: the statements will fail against a database that is
 * not actually at `from`.
 */
export async function renderMigrationScript({
  dialect,
  stores,
  from,
}: MigrationScript): Promise<string> {
  const blocks: string[] = [];
  for (const store of stores) {
    const statements = await storeStatements(dialect, store, from);
    if (statements.length > 0) blocks.push([`-- store: ${store.id}`, ...statements].join('\n\n'));
  }

  const header = [
    `-- @a2a-js/sdk schema for ${dialect}: ${from} -> ${LATEST}.`,
    `-- Rendered offline: nothing read the database, so this assumes it is at "${from}".`,
  ];

  // No trailing newline: whatever prints this adds the one a file ends with.
  if (blocks.length === 0) {
    return [...header, `-- Nothing to do: every selected store is already at ${LATEST}.`].join(
      '\n'
    );
  }
  // Both of these describe statements below, so they belong to the non-empty script only.
  header.push(
    "-- Each store's ledger is written too, so `a2a-db status` keeps matching the schema."
  );
  // Wrapping is left to whoever applies this: MySQL commits DDL implicitly and D1 rejects
  // BEGIN, so a wrapper could only ever cover some engines.
  header.push('-- Not wrapped in a transaction. Check the ledger if it stops partway.');
  return `${header.join('\n')}\n\n${blocks.join('\n\n')}`;
}

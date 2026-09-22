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

/** Which way through a store's history a range runs. */
export type MigrationDirection = 'up' | 'down';

/**
 * How a destination reads when none was named, since the migration it resolves to is a
 * different one in each store.
 */
const PREVIOUS = 'the previous migration';

/**
 * Where a point in a store's history sits, as the index of the migration applied there.
 * {@link BASE} precedes every migration; {@link LATEST} is the last of them.
 */
function positionOf(names: readonly string[], point: string): number {
  if (point === BASE) return -1;
  if (point === LATEST) return names.length - 1;
  const at = names.indexOf(point);
  if (at === -1) {
    throw new Error(
      `"${point}" is not a migration. Expected "${BASE}", "${LATEST}", or one of: ` +
        `${names.join(', ')}.`
    );
  }
  return at;
}

/** The migrations between two points, in the order they run to get from one to the other. */
function span(
  store: StoreMigrations,
  from: string,
  to: string | undefined
): { direction: MigrationDirection; names: string[] } {
  const names = migrationNames(store);
  const start = positionOf(names, from);
  // No destination reverts a single migration, as a bare online downgrade does. It
  // resolves per store, since "the previous one" names a different migration in each.
  const end = to === undefined ? Math.max(start - 1, -1) : positionOf(names, to);
  return end >= start
    ? { direction: 'up', names: names.slice(start + 1, end + 1) }
    : { direction: 'down', names: names.slice(end + 1, start + 1).reverse() };
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
 * Every statement moving one store from `from` to `to`.
 *
 * The migrator cannot do this: it picks what to run by reading the ledger, and a script
 * has none to read. Naming both ends makes the answer static, so the migrations are
 * driven directly and their ledger rows written alongside.
 */
async function storeStatements(
  dialect: DialectName,
  store: StoreMigrations,
  from: string,
  to: string | undefined,
  expected: MigrationDirection
): Promise<string[]> {
  const { direction, names } = span(store, from, to);
  // An empty range runs neither way, so it is nothing to do rather than a contradiction.
  if (names.length === 0) return [];
  if (direction !== expected) {
    // Reachable once a store has two migrations, where <to> can sit the wrong side of
    // --from. Without it a downgrade would quietly render a set of create statements.
    throw new Error(
      `"${from}" to "${to ?? PREVIOUS}" moves ${direction} the ${store.id} store, but ` +
        `this is ${expected === 'up' ? 'an upgrade' : 'a downgrade'}.`
    );
  }

  const { db, recorded } = recordingKysely<LedgerDatabase>(dialect);
  // Migrations are written against the schema they create, which this one does not know.
  const target = db as Kysely<unknown>;

  try {
    if (direction === 'up' && from === BASE) await createLedger(db, store).execute();

    for (const name of names) {
      if (direction === 'up') {
        await store.migrations[name].up(target);
        // `Migrator` stamps when the migration ran. A script can only stamp when it was
        // written, which is what `a2a-db status` reports once it has been applied.
        await db
          .insertInto(store.ledgerTable)
          .values({ name: sql.lit(name), timestamp: sql.lit(new Date().toISOString()) })
          .execute();
        continue;
      }

      const { down } = store.migrations[name];
      if (down === undefined) {
        // `Migrator` skips these and leaves the ledger row standing. A script cannot:
        // it would drop nothing while reading as reverted.
        throw new Error(`"${name}" has no down migration, so ${store.id} cannot revert past it.`);
      }
      await down(target);
      await db.deleteFrom(store.ledgerTable).where('name', '=', sql.lit(name)).execute();
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
  /** Where to stop. Absent reverts a single migration, as a bare online downgrade does. */
  readonly to?: string;
  /** Which way the caller meant to go. A range running the other way is refused. */
  readonly direction: MigrationDirection;
}

/**
 * A script moving every selected store from `from` to `to`, for an engine this CLI never
 * connects to. No driver is loaded and nothing is read, so both ends are taken on trust:
 * the statements will fail against a database that is not actually at `from`.
 */
export async function renderMigrationScript({
  dialect,
  stores,
  from,
  to,
  direction,
}: MigrationScript): Promise<string> {
  const blocks: string[] = [];
  for (const store of stores) {
    const statements = await storeStatements(dialect, store, from, to, direction);
    if (statements.length > 0) blocks.push([`-- store: ${store.id}`, ...statements].join('\n\n'));
  }

  // Naming no destination means one migration back, so the header describes it rather
  // than naming a migration that differs per store.
  const destination = to ?? PREVIOUS;
  const header = [
    `-- @a2a-js/sdk schema for ${dialect}: ${from} -> ${destination}.`,
    `-- Rendered offline: nothing read the database, so this assumes it is at "${from}".`,
  ];

  // No trailing newline: whatever prints this adds the one a file ends with.
  if (blocks.length === 0) {
    return [...header, `-- Nothing to do: every selected store is already at ${destination}.`].join(
      '\n'
    );
  }
  // Both of these describe statements below, so they belong to the non-empty script only.
  // A revert deletes the rows an upgrade writes, so the ledger tracks either way.
  header.push(
    "-- Each store's ledger is kept in step, so `a2a-db status` keeps matching the schema."
  );
  // Wrapping is left to whoever applies this: MySQL commits DDL implicitly and D1 rejects
  // BEGIN, so a wrapper could only ever cover some engines.
  header.push('-- Not wrapped in a transaction. Check the ledger if it stops partway.');
  return `${header.join('\n')}\n\n${blocks.join('\n\n')}`;
}

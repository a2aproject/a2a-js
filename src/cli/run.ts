import { parseArgs } from 'node:util';

import { NO_MIGRATIONS } from 'kysely/migration';

import {
  BASE,
  migrateStore,
  migrateStoreTo,
  migrationNames,
  rollbackStore,
  storeState,
} from '../server/database/migrator.js';
import type { StoreMigrations } from '../server/database/migrator.js';
import { ALL_STORES } from '../server/database/stores.js';
import { connect } from './connect.js';

const STORE_IDS = ALL_STORES.map((store) => store.id);

const USAGE = `a2a-db — schema management for @a2a-js/sdk database stores

Usage:
  a2a-db status    [--url <database-url>] [--store <id>]...
  a2a-db upgrade   [--url <database-url>] [--store <id>]...
  a2a-db downgrade [--url <database-url>] [--store <id>]... [<to>]
  a2a-db --help

  status     Lists each migration and whether the ledger has recorded it. Changes
             nothing.
  upgrade    Applies any migrations the database has not yet run. Safe to re-run:
             migrations already recorded in the ledger are skipped.
  downgrade  Reverts the most recent migration of each selected store. <to> says
             where to stop instead: "base" reverts every migration, and a
             migration name reverts down to it, leaving that one applied.
             Whatever the reverted migrations created is dropped with it.

Each store keeps its own ledger, so they upgrade and revert independently.
Repeat --store to select several; omit it to cover every store:

  ${STORE_IDS.join(', ')}

The database URL comes from --url, or from DATABASE_URL. Its scheme selects the
driver, which you install yourself:

  postgresql://…   needs pg              (or postgres://)
  mysql://…        needs mysql2
  sqlite:./a2a.db  needs better-sqlite3
`;

const OPTIONS = {
  url: { type: 'string' },
  store: { type: 'string', multiple: true },
  help: { type: 'boolean', short: 'h' },
} as const;

/**
 * The stores `--store` names, or every store when it names none.
 */
function selectStores(ids: readonly string[] | undefined): readonly StoreMigrations[] {
  if (ids === undefined || ids.length === 0) return ALL_STORES;
  const wanted = new Set(ids);
  return ALL_STORES.filter((store) => wanted.has(store.id));
}

/**
 * Runs the CLI and resolves to a process exit code.
 * Separated from the executable so it can be driven in-process by tests.
 */
export async function run(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  output: Pick<Console, 'log' | 'error'> = console
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], allowPositionals: true, options: OPTIONS });
  } catch (error) {
    output.error(`${(error as Error).message}\n\n${USAGE}`);
    return 1;
  }

  const [command] = parsed.positionals;

  if (parsed.values.help || command === 'help') {
    output.log(USAGE);
    return 0;
  }
  if (!command) {
    output.error(USAGE);
    return 1;
  }
  if (command !== 'status' && command !== 'upgrade' && command !== 'downgrade') {
    output.error(`Unknown command "${command}".\n\n${USAGE}`);
    return 1;
  }
  const target = parsed.positionals[1];
  for (const id of parsed.values.store ?? []) {
    if (!STORE_IDS.includes(id)) {
      output.error(`Unknown store "${id}". Expected one of: ${STORE_IDS.join(', ')}.`);
      return 1;
    }
  }
  const stores = selectStores(parsed.values.store);

  if (command === 'downgrade' && target !== undefined && target !== BASE) {
    // "base" suits any store; a migration name belongs to one store's history.
    if (stores.length !== 1) {
      output.error(
        `Reverting to "${target}" needs exactly one --store, since a migration name ` +
          `belongs to a single store's history. Available: ${STORE_IDS.join(', ')}.`
      );
      return 1;
    }
    if (!migrationNames(stores[0]).includes(target)) {
      output.error(
        `"${target}" is not a migration of the ${stores[0].id} store. ` +
          `Expected "${BASE}" or one of: ${migrationNames(stores[0]).join(', ')}.`
      );
      return 1;
    }
  }

  const url = parsed.values.url ?? env.DATABASE_URL;
  if (!url) {
    output.error('No database URL. Pass --url <database-url> or set DATABASE_URL.');
    return 1;
  }

  let db;
  try {
    db = await connect(url);
  } catch (error) {
    output.error((error as Error).message);
    return 1;
  }

  try {
    if (command === 'status') {
      for (const store of stores) {
        output.log(store.id);
        for (const { name, executedAt } of await storeState(db, store)) {
          const when = executedAt ? `applied  ${executedAt.toISOString()}` : 'pending';
          output.log(`  ${name}  ${when}`);
        }
      }
    } else if (command === 'upgrade') {
      for (const store of stores) {
        await migrateStore(db, store);
        output.log(`${store.id}: up to date`);
      }
    } else if (target === undefined) {
      for (const store of stores) {
        const revertedMigration = await rollbackStore(db, store);
        output.log(
          revertedMigration
            ? `${store.id}: reverted ${revertedMigration}`
            : `${store.id}: nothing to revert`
        );
      }
    } else {
      for (const store of stores) {
        await migrateStoreTo(db, store, target === BASE ? NO_MIGRATIONS : target);
        output.log(`${store.id}: now at ${target}`);
      }
    }
    return 0;
  } catch (error) {
    output.error(error);
    return 1;
  } finally {
    // Throwing here would replace the return above, failing a run that succeeded.
    await db.destroy().catch((error: unknown) => output.error(error));
  }
}

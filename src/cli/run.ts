import { parseArgs } from 'node:util';

import type { DialectName } from '../server/database/dialect.js';
import {
  PUSH_NOTIFICATION_STORE_ID,
  pushNotificationStoreMigrations,
} from '../server/database/push_notification/migrations.js';
import type { StoreMigrations } from '../server/database/store_migrations.js';
import { TASK_STORE_ID, taskStoreMigrations } from '../server/database/task/migrations.js';
import { connect } from './connect.js';
import {
  BASE,
  migrateStore,
  migrateStoreTo,
  migrationNames,
  rollbackStore,
  storeState,
} from './migrator.js';
import { DIALECT_NAMES } from './offline.js';
import { LATEST, renderMigrationScript } from './sql_script.js';

/**
 * Every store this CLI manages, against the table names it is given. Those are keyed by
 * {@link StoreMigrations.id} so a caller names the store it is renaming rather than
 * counting positions; an id with no entry keeps its default table.
 */
function allStoreMigrations(
  tableNames: Readonly<Record<string, string>> = {}
): readonly StoreMigrations[] {
  return [
    pushNotificationStoreMigrations(tableNames[PUSH_NOTIFICATION_STORE_ID]),
    taskStoreMigrations(tableNames[TASK_STORE_ID]),
  ];
}

/** Every id {@link allStoreMigrations} accepts, in the order it returns them. */
const STORE_IDS: readonly string[] = allStoreMigrations().map((store) => store.id);

/** The flag naming one store's table. Builds {@link OPTIONS} as well as reading it. */
function tableNameFlag(storeId: string): string {
  return `${storeId}-table-name`;
}

const USAGE = `a2a-db — schema management for @a2a-js/sdk database stores

Usage:
  a2a-db status    [<options>]
  a2a-db upgrade   [<options>] [--sql --dialect <name> [--from <revision>]]
  a2a-db downgrade [<options>] [<to>]
  a2a-db --help

  status     Lists each migration and whether the ledger has recorded it. Changes
             nothing.
  upgrade    Applies any migrations the database has not yet run. Safe to re-run:
             migrations already recorded in the ledger are skipped.
  downgrade  Reverts the most recent migration of each selected store. <to> says
             where to stop instead: "base" reverts every migration, and a
             migration name reverts down to it, leaving that one applied.
             Whatever the reverted migrations created is dropped with it.

Options, for every command:
  --url <database-url>    Defaults to DATABASE_URL.
  --store <id>            Repeatable. Omit to cover every store.
  --<store-id>-table-name <name>
                          Renames one store's table:
${STORE_IDS.map((id) => `                            --${tableNameFlag(id)}`).join('\n')}

Options, for upgrade --sql only:
  --sql                   Print the statements instead of running them. Connects
                          to nothing, so --url goes unread.
  --dialect <name>        Required. Which SQL to write: ${DIALECT_NAMES.join(', ')}.
  --from <revision>       The migration already applied. Defaults to "${BASE}", an
                          empty database.

Each store keeps its own ledger, so they upgrade and revert independently:
${STORE_IDS.join(', ')}.

A store renamed here must be given the same name in the code that reads it, as
the "tableName" option of DatabaseTaskStore or DatabasePushNotificationStore.
Its ledger follows the table, as a2a_<name>_migrations:

  a2a-db upgrade --${tableNameFlag(TASK_STORE_ID)} agent_tasks

The rendered script follows the rename too, table and derived ledger alike:

  a2a-db upgrade --${tableNameFlag(TASK_STORE_ID)} agent_tasks --sql --dialect sqlite

The database URL comes from --url, or from DATABASE_URL. Its scheme selects the
driver, which you install yourself:

  postgresql://…   needs pg              (or postgres://)
  mysql://…        needs mysql2
  sqlite:./a2a.db  needs better-sqlite3

--sql prints the statements upgrade would run instead of running them: for
review, or for a database this CLI cannot reach. Nothing is connected to and no
driver is loaded, which is why --dialect has to name the engine and --url goes
unread. Cloudflare D1 speaks sqlite.

Rendering always ends at the latest migration. It cannot discover where the
database already starts, having read nothing, so --from names the migration
applied there; omit it for an empty database:

  a2a-db upgrade --sql --dialect sqlite
  a2a-db upgrade --sql --dialect postgres --from 0001_create_tasks
`;

const OPTIONS = {
  url: { type: 'string' },
  store: { type: 'string', multiple: true },
  sql: { type: 'boolean' },
  dialect: { type: 'string' },
  from: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  // One per store, from the same source the reader below uses, so a new store gets its
  // flag and the two cannot name it differently.
  ...Object.fromEntries(STORE_IDS.map((id) => [tableNameFlag(id), { type: 'string' as const }])),
} as const;

/**
 * The table each `--<store-id>-table-name` names, keyed by store id. A store whose flag
 * is absent keeps its default table.
 */
function tableNames(values: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  const named: Record<string, string> = {};

  for (const id of STORE_IDS) {
    const flag = tableNameFlag(id);
    const tableName = values[flag];
    if (typeof tableName !== 'string') continue;
    if (tableName === '') {
      throw new Error(`Empty table name in --${flag}.`);
    }
    named[id] = tableName;
  }

  return named;
}

/**
 * Which SQL to write. Named outright rather than read off a URL, since rendering never
 * connects and the URL of a database it is not talking to says nothing binding.
 */
function resolveDialect(requested: string | undefined): DialectName {
  if (requested === undefined) {
    throw new Error(`--sql needs --dialect, one of: ${DIALECT_NAMES.join(', ')}.`);
  }
  if ((DIALECT_NAMES as readonly string[]).includes(requested)) return requested as DialectName;
  throw new Error(`Unknown dialect "${requested}". Expected one of: ${DIALECT_NAMES.join(', ')}.`);
}

/**
 * `base` fits any store, but a migration name belongs to one store's history, so naming
 * one has to say which store it means.
 */
function checkRevision(revision: string, stores: readonly StoreMigrations[]): void {
  if (revision === BASE) return;
  if (revision === LATEST) {
    throw new Error(
      `"${LATEST}" is where rendering ends, not where it starts. --from names the ` +
        `migration already applied, or "${BASE}" for an empty database.`
    );
  }
  if (stores.length === 1) return;
  throw new Error(
    `"${revision}" is a migration name, which belongs to a single store's history, so it ` +
      `needs exactly one --store. Available: ${STORE_IDS.join(', ')}.`
  );
}

/**
 * The stores `--store` names, or every store when it names none.
 */
function selectStores(
  all: readonly StoreMigrations[],
  ids: readonly string[] | undefined
): readonly StoreMigrations[] {
  if (ids === undefined || ids.length === 0) return all;
  const wanted = new Set(ids);
  return all.filter((store) => wanted.has(store.id));
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

  let stores;
  try {
    stores = selectStores(allStoreMigrations(tableNames(parsed.values)), parsed.values.store);
  } catch (error) {
    output.error((error as Error).message);
    return 1;
  }

  if (command === 'upgrade' && target !== undefined) {
    // Ahead of --sql, so rendering refuses a revision too rather than quietly starting
    // from base. Silently ignoring it would read as having honoured it.
    output.error(
      `upgrade takes no positional argument ("${target}"). --sql renders from a ` +
        `revision with --from.`
    );
    return 1;
  }

  if (parsed.values.sql) {
    if (command !== 'upgrade') {
      // Both of the others answer from what the ledger already holds, which is the one
      // thing rendering never reads.
      output.error(`--sql renders an upgrade; "${command}" works from the ledger.`);
      return 1;
    }
    try {
      const from = parsed.values.from ?? BASE;
      checkRevision(from, stores);
      output.log(
        await renderMigrationScript({
          dialect: resolveDialect(parsed.values.dialect),
          stores,
          from,
        })
      );
    } catch (error) {
      output.error((error as Error).message);
      return 1;
    }
    return 0;
  }
  if (parsed.values.dialect !== undefined) {
    // Connecting settles the engine, so accepting --dialect would invite it to disagree.
    output.error('--dialect only applies with --sql; a connected database names its own.');
    return 1;
  }
  if (parsed.values.from !== undefined) {
    // The ledger records where a reachable database got to, so asserting it would only
    // let the two disagree.
    output.error('--from only applies with --sql; a connected database has a ledger.');
    return 1;
  }

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
        await migrateStoreTo(db, store, target);
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

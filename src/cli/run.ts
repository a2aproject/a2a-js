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
import type { MigrationDirection } from './sql_script.js';
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
  a2a-db downgrade [<options>] [<to>] [--sql --dialect <name> [--from <revision>]]
  a2a-db --help

Commands:
  status     Show migration status for each store.
  upgrade    Apply pending migrations. Safe to re-run.
  downgrade  Revert migrations. Reverts the latest migration by default.
             Pass <to> as a migration name to stop at (leaving it applied),
             or "${BASE}" to revert all.

Options:
  --url <url>             Database URL (postgresql://, postgres://, mysql://, sqlite:).
                          Defaults to the DATABASE_URL environment variable.
  --store <id>            Target a specific store (repeatable). Default: all stores.
                          Required when naming a migration.
                          Available: ${STORE_IDS.join(', ')}.
  --<store-id>-table-name <name>
                          Override a store's table name:
${STORE_IDS.map((id) => `                            --${tableNameFlag(id)}`).join('\n')}

Options (--sql only):
  --sql                   Print SQL statements instead of connecting to a database.
  --dialect <name>        Target SQL dialect: ${DIALECT_NAMES.join(', ')}.
                          Required with --sql.
  --from <revision>       Starting point ("${BASE}", "${LATEST}", or a migration name).
                          Defaults to "${BASE}" for upgrade, "${LATEST}" for downgrade.

Drivers:
  Driver packages must be installed separately:
    postgresql://…  -> npm install pg
    mysql://…       -> npm install mysql2
    sqlite:…        -> npm install better-sqlite3

Offline (--sql):
  Generates raw SQL for review or environments where the CLI cannot connect
  directly (such as Cloudflare D1, which uses the sqlite dialect).
  Does not connect to a database; ignores --url.

  The rendered SQL updates the migration ledger alongside the tables. Once
  applied, online commands see the database as if the migration ran online.

Table Renaming:
  When using custom table names, pass the name configured in your store.
  The migration ledger table is renamed automatically to match.

Examples:
  # Online migrations:
  a2a-db upgrade
  a2a-db downgrade
  a2a-db downgrade base

  # Generate SQL for an empty database (defaults to --from base):
  a2a-db upgrade --sql --dialect sqlite

  # Generate SQL from a specific migration forward:
  a2a-db upgrade --sql --dialect postgres --store ${TASK_STORE_ID} --from <revision>

  # Generate SQL to revert the last migration:
  a2a-db downgrade --sql --dialect sqlite

  # Generate SQL to revert all migrations down to base:
  a2a-db downgrade base --sql --dialect sqlite

  # Generate SQL to revert to base from a specific migration:
  a2a-db downgrade base --sql --dialect mysql --store ${TASK_STORE_ID} --from <revision>

  # Custom table name:
  a2a-db upgrade --${tableNameFlag(TASK_STORE_ID)} agent_tasks
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
 * `base` and `latest` apply across every store, but a migration name belongs to a
 * single store's history and requires `--store`. Which values are accepted depends on
 * the command: an upgrade starts at `base`, while a revert starts at `latest` and stops
 * at `base`.
 */
function checkRevision(
  revision: string,
  stores: readonly StoreMigrations[],
  accepted: readonly string[]
): void {
  if (accepted.includes(revision)) return;
  // Ahead of the --store check, so a name no store has is reported as unknown rather than
  // as ambiguous, which would advise a --store that cannot help.
  if (!stores.some((store) => migrationNames(store).includes(revision))) {
    const histories = stores
      .map((store) => `${store.id} (${migrationNames(store).join(', ')})`)
      .join(', ');
    throw new Error(
      `"${revision}" is not a migration. Expected ` +
        `${accepted.map((name) => `"${name}"`).join(', ')} or one of: ${histories}.`
    );
  }
  if (stores.length === 1) return;
  throw new Error(
    `"${revision}" is a migration name, which belongs to a single store's history, so it ` +
      `needs exactly one --store. Available: ${STORE_IDS.join(', ')}.`
  );
}

/**
 * Where a range starts. `base` and `latest` name the ends of a history, and neither run
 * can start where it would stop: an upgrade runs toward `latest`, a revert away from it.
 * A migration name carries no such direction, so it fits either end.
 */
function checkStart(direction: MigrationDirection, from: string): void {
  if (direction === 'up') {
    if (from !== LATEST) return;
    throw new Error(
      `"${LATEST}" is where an upgrade ends, not where it starts. --from names the ` +
        `migration already applied, or "${BASE}" for an empty database.`
    );
  }
  if (from === BASE) {
    throw new Error(
      `"${BASE}" is where a downgrade ends, not where it starts. --from names the ` +
        `migration already applied, or "${LATEST}" for a fully migrated database.`
    );
  }
}

/**
 * Where a revert stops: `base` or a migration name, never `latest`, which is where one
 * starts. Online and rendered both come through here, so a bad destination is answered
 * the same way either way.
 */
function checkDestination(target: string, stores: readonly StoreMigrations[]): void {
  if (target === LATEST) {
    throw new Error(
      `"${LATEST}" is where a downgrade starts, not where it stops. Pass "${BASE}" or a ` +
        `migration name.`
    );
  }
  checkRevision(target, stores, [BASE]);
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
    if (command === 'status') {
      // status answers from what the ledger already holds, which is the one thing
      // rendering never reads.
      output.error('--sql renders a migration; status only reports what the ledger holds.');
      return 1;
    }
    // Both ends default to what the online command does: an upgrade runs from wherever
    // the database is to the latest migration, and a bare downgrade reverts one.
    const upgrading = command === 'upgrade';
    const direction: MigrationDirection = upgrading ? 'up' : 'down';
    const from = parsed.values.from ?? (upgrading ? BASE : LATEST);
    const to = upgrading ? LATEST : target;
    try {
      checkStart(direction, from);
      checkRevision(from, stores, [direction === 'up' ? BASE : LATEST]);
      if (target !== undefined) checkDestination(target, stores);
      output.log(
        await renderMigrationScript({
          dialect: resolveDialect(parsed.values.dialect),
          stores,
          from,
          to,
          direction,
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

  if (command === 'downgrade' && target !== undefined) {
    try {
      checkDestination(target, stores);
    } catch (error) {
      output.error((error as Error).message);
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

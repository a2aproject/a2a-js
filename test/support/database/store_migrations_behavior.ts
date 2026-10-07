// The a2a-db tests every store's migrations have to pass, on each engine the Node suites
// reach. A store's spec spells out its table in a MigratedStore and hands it to
// describeStoreMigrations.
import { beforeEach, describe, expect, it } from 'vitest';
import { inspect } from 'node:util';

import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { run } from '../../../src/cli/run.js';
import {
  describeOnEachEngine,
  freshSqliteUrl,
  withConnection,
  type Server,
} from './node_engines.js';

const LOCK_TABLE = 'a2a_migrations_lock';
/** The revision the CLI translates into Kysely's NO_MIGRATIONS. */
const BASE = 'base';
/** The other end of a history, which a revert starts at rather than stops at. */
const LATEST = 'latest';

/**
 * A store's table and history, spelled out in the store's spec rather than imported from
 * the store: a test that reads these from the code it checks cannot catch a rename, and a
 * renamed ledger makes a migrated database look untouched.
 */
export interface MigratedStore {
  /** Names the suites: "a2a-db <title> migrations on <engine>". */
  readonly title: string;
  /** What `--store` takes. */
  readonly id: string;
  readonly table: string;
  readonly ledgerTable: string;
  /** The store's only migration so far. */
  readonly migration: string;
  /** The flag that renames the table. */
  readonly tableNameFlag: string;
  /** The primary key, in order. */
  readonly keyColumns: readonly string[];
  readonly allColumns: readonly string[];
  readonly notNullColumns: readonly string[];
  readonly nullableColumns: readonly string[];
  /** The width each of these varchar columns must have. */
  readonly widths: Readonly<Record<string, number>>;
  /** The columns that must carry the engine's binary collation. */
  readonly collatedColumns: readonly string[];
  /** The secondary indexes, each with its columns in order. Empty for a table with none. */
  readonly indexes: Readonly<Record<string, readonly string[]>>;
  /** Two names a deployment might pick instead of the default, and the ledger each derives. */
  readonly renamedTable: string;
  readonly renamedLedgerTable: string;
  readonly secondTable: string;
  readonly secondLedgerTable: string;
  /**
   * The other store's table and ledger. `upgrade` with no --store migrates every store, so
   * the teardown has to clear them too or they outlive the test on a shared server.
   */
  readonly otherStoreTables: readonly string[];
  /** Names the SQLite temp directories. */
  readonly sqlitePrefix: string;
}

/**
 * What differs between engines: how to reach a database, how the binary collation is
 * spelled, and how to read back the four things Kysely's portable introspector does not
 * expose — width, collation, position in the key, and the secondary indexes.
 */
interface MigrationsEngine {
  readonly name: string;
  /** The collation the collated columns must carry here, spelled this engine's way. */
  readonly binaryCollation: string;
  /** A URL whose database holds none of this store's tables. */
  freshUrl(): string;
  widths(db: Kysely<unknown>): Promise<Record<string, number>>;
  collations(db: Kysely<unknown>): Promise<Record<string, string | null>>;
  keyOrder(db: Kysely<unknown>): Promise<string[]>;
  /** Secondary indexes only. */
  indexes(db: Kysely<unknown>): Promise<Record<string, string[]>>;
}

/** `information_schema` names its own columns lowercase on PostgreSQL, uppercase on MySQL. */
function lowerKeys(rows: unknown[]): Record<string, unknown>[] {
  return (rows as Record<string, unknown>[]).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]))
  );
}

async function query(db: Kysely<unknown>, text: string): Promise<Record<string, unknown>[]> {
  return lowerKeys((await sql.raw(text).execute(db)).rows);
}

/** Both servers report one row per indexed column; only the query to get them differs. */
function groupIndexColumns(rows: Record<string, unknown>[]): Record<string, string[]> {
  const indexes: Record<string, string[]> = {};
  for (const row of rows) {
    const name = String(row.index_name);
    (indexes[name] ??= []).push(String(row.column_name));
  }
  return indexes;
}

function sqliteEngine(table: string, sqlitePrefix: string): MigrationsEngine {
  return {
    name: 'sqlite',
    binaryCollation: 'binary',
    freshUrl: freshSqliteUrl(sqlitePrefix),
    async widths(db) {
      // SQLite stores the declared type verbatim and never enforces it, so the width is
      // read back out of that string rather than from a limit the engine applies.
      const rows = await query(db, `PRAGMA table_info(${table})`);
      return Object.fromEntries(
        rows
          .map(
            (row) => [String(row.name), /varchar\((\d+)\)/i.exec(String(row.type))?.[1]] as const
          )
          .filter(([, width]) => width !== undefined)
          .map(([name, width]) => [name, Number(width)])
      );
    },
    async collations(db) {
      // Read out of the stored DDL rather than the indexes: `PRAGMA index_xinfo` reports a
      // collation only for indexed columns, and a collated column need not be in one.
      const [ddl] = await query(
        db,
        `select sql from sqlite_master where type = 'table' and name = '${table}'`
      );
      const collations: Record<string, string> = {};
      for (const [, column, collation] of String(ddl?.sql ?? '').matchAll(
        /"(\w+)"\s+\w+(?:\(\d+\))?\s+collate\s+(\w+)/gi
      )) {
        collations[column] = collation;
      }
      return collations;
    },
    async keyOrder(db) {
      const rows = await query(db, `PRAGMA table_info(${table})`);
      return rows
        .filter((row) => Number(row.pk) > 0)
        .sort((a, b) => Number(a.pk) - Number(b.pk))
        .map((row) => String(row.name));
    },
    async indexes(db) {
      const indexes: Record<string, string[]> = {};
      for (const index of await query(db, `PRAGMA index_list(${table})`)) {
        // The primary key gets an index of its own, which keyOrder already covers.
        if (index.origin === 'pk') continue;
        const columns = await query(db, `PRAGMA index_info('${String(index.name)}')`);
        indexes[String(index.name)] = columns
          .sort((a, b) => Number(a.seqno) - Number(b.seqno))
          .map((column) => String(column.name));
      }
      return indexes;
    },
  };
}

/** PostgreSQL and MySQL are read the same way, differing only in these. */
const DIALECTS = {
  postgres: {
    binaryCollation: 'C',
    currentSchema: 'current_schema()',
    indexesSql: (table: string) => `
      select i.relname as index_name, a.attname as column_name
      from pg_class t
      join pg_index ix on ix.indrelid = t.oid
      join pg_class i on i.oid = ix.indexrelid
      cross join lateral unnest(ix.indkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      where t.relname = '${table}' and not ix.indisprimary
      order by i.relname, k.ord`,
  },
  mysql: {
    binaryCollation: 'utf8mb4_0900_bin',
    currentSchema: 'database()',
    indexesSql: (table: string) => `
      select index_name, column_name
      from information_schema.statistics
      where table_name = '${table}' and table_schema = database() and index_name <> 'PRIMARY'
      order by index_name, seq_in_index`,
  },
} as const;

function informationSchemaEngine(table: string, server: Server, url: string): MigrationsEngine {
  const { binaryCollation, currentSchema, indexesSql } = DIALECTS[server.name];
  const scoped = `table_name = '${table}' and table_schema = ${currentSchema}`;
  return {
    name: server.name,
    binaryCollation,
    // The server already exists; unlike SQLite there is no new one to make per test.
    freshUrl: () => url,
    async widths(db) {
      const rows = await query(
        db,
        `select column_name, character_maximum_length
         from information_schema.columns where ${scoped}`
      );
      return Object.fromEntries(
        rows
          .filter((row) => row.character_maximum_length !== null)
          .map((row) => [String(row.column_name), Number(row.character_maximum_length)])
      );
    },
    async collations(db) {
      const rows = await query(
        db,
        `select column_name, collation_name from information_schema.columns where ${scoped}`
      );
      return Object.fromEntries(
        rows.map((row) => [
          String(row.column_name),
          row.collation_name === null ? null : String(row.collation_name),
        ])
      );
    },
    async keyOrder(db) {
      // The constraint name is not asserted: MySQL calls every primary key `PRIMARY`,
      // whatever the migration named it.
      const rows = await query(
        db,
        `select k.column_name from information_schema.key_column_usage k
         join information_schema.table_constraints c
           on c.constraint_name = k.constraint_name
          and c.table_name = k.table_name
          and c.table_schema = k.table_schema
         where k.table_name = '${table}' and k.table_schema = ${currentSchema}
           and c.constraint_type = 'PRIMARY KEY'
         order by k.ordinal_position`
      );
      return rows.map((row) => String(row.column_name));
    },
    async indexes(db) {
      return groupIndexColumns(await query(db, indexesSql(table)));
    },
  };
}

/** Declares the tests for `store`, once per engine. */
export function describeStoreMigrations(store: MigratedStore): void {
  const {
    id: STORE_ID,
    table: TABLE,
    ledgerTable: LEDGER_TABLE,
    migration: MIGRATION,
    tableNameFlag: TABLE_NAME_FLAG,
    keyColumns: KEY_COLUMNS,
    allColumns: ALL_COLUMNS,
    notNullColumns: NOT_NULL_COLUMNS,
    nullableColumns: NULLABLE_COLUMNS,
    widths: WIDTHS,
    collatedColumns: COLLATED_COLUMNS,
    indexes: INDEXES,
    renamedTable: RENAMED_TABLE,
    renamedLedgerTable: RENAMED_LEDGER_TABLE,
    secondTable: SECOND_TABLE,
    secondLedgerTable: SECOND_LEDGER_TABLE,
    otherStoreTables: OTHER_STORE_TABLES,
  } = store;
  const RENAMED_TABLES = [RENAMED_TABLE, RENAMED_LEDGER_TABLE, SECOND_TABLE, SECOND_LEDGER_TABLE];

  describeOnEachEngine(
    `a2a-db ${store.title} migrations`,
    sqliteEngine(TABLE, store.sqlitePrefix),
    (server, url) => informationSchemaEngine(TABLE, server, url),
    (engine) => {
      let url: string;

      /**
       * Every read opens its own connection, because the CLI does its work on a different
       * one. SQLite answers `PRAGMA index_list` out of a schema cached when the connection
       * opened, so a connection older than the migration reports no indexes at all.
       */
      function introspect<T>(read: (db: Kysely<unknown>) => Promise<T>): Promise<T> {
        return withConnection(url, read);
      }

      /** Everything a test here can create, so the next one starts from nothing. */
      const dropTables = () =>
        introspect(async (db) => {
          for (const table of [
            TABLE,
            LEDGER_TABLE,
            LOCK_TABLE,
            ...OTHER_STORE_TABLES,
            ...RENAMED_TABLES,
          ]) {
            await sql.raw(`drop table if exists ${table}`).execute(db);
          }
        });

      beforeEach(async () => {
        url = engine.freshUrl();
        // SQLite gets a new file each time; the shared servers need the last run cleared.
        await dropTables();
      });

      /**
       * Drives the CLI in-process, capturing what it would have printed. Rendered with
       * `inspect` because that is what `console.error` uses: plain `String()` would drop
       * the `cause` chain the migration runner attaches.
       */
      async function cli(...args: string[]) {
        const out: string[] = [];
        const err: string[] = [];
        const render = (parts: unknown[]) =>
          parts.map((part) => (typeof part === 'string' ? part : inspect(part))).join(' ');
        const code = await run(
          [...args, '--url', url],
          {},
          {
            log: (...parts) => out.push(render(parts)),
            error: (...parts) => err.push(render(parts)),
          }
        );
        return { code, out: out.join('\n'), err: err.join('\n') };
      }

      const tableNames = () =>
        introspect(async (db) => (await db.introspection.getTables()).map((table) => table.name));

      const columnsOf = (table: string = TABLE) =>
        introspect(
          async (db) =>
            (await db.introspection.getTables()).find((t) => t.name === table)?.columns ?? []
        );

      /**
       * Everything about the table an up-and-down cycle ought to reproduce exactly.
       * Absent is an error rather than a value, so two snapshots of a missing table cannot
       * compare equal and pass a lifecycle test that proved nothing.
       */
      const structure = () =>
        introspect(async (db) => {
          const table = (await db.introspection.getTables()).find((t) => t.name === TABLE);
          if (!table) throw new Error(`${TABLE} does not exist`);
          return {
            columns: table.columns.map((column) => `${column.name}:${column.isNullable}`).sort(),
            widths: await engine.widths(db),
            keyOrder: await engine.keyOrder(db),
            collations: await engine.collations(db),
            indexes: await engine.indexes(db),
          };
        });

      it('upgrade creates the table, the ledger and the lock', async () => {
        const { code } = await cli('upgrade');

        expect(code).toBe(0);
        expect(await tableNames()).toEqual(
          expect.arrayContaining([TABLE, LEDGER_TABLE, LOCK_TABLE])
        );
      });

      it('upgrade creates exactly the expected columns', async () => {
        await cli('upgrade');

        expect((await columnsOf()).map((column) => column.name).sort()).toEqual(
          [...ALL_COLUMNS].sort()
        );
      });

      it('upgrade sets the expected nullability on every column', async () => {
        await cli('upgrade');

        const nullable = Object.fromEntries(
          (await columnsOf()).map((column) => [column.name, column.isNullable])
        );
        for (const column of NOT_NULL_COLUMNS) expect(nullable[column]).toBe(false);
        for (const column of NULLABLE_COLUMNS) expect(nullable[column]).toBe(true);
      });

      it('upgrade sets the expected width on every varchar column', async () => {
        await cli('upgrade');

        expect(await introspect((db) => engine.widths(db))).toMatchObject(WIDTHS);
      });

      it('upgrade sets the primary key to the key columns, in order', async () => {
        await cli('upgrade');

        expect(await introspect((db) => engine.keyOrder(db))).toEqual(KEY_COLUMNS);
      });

      it('upgrade sets the binary collation on every collated column', async () => {
        await cli('upgrade');

        const collations = await introspect((db) => engine.collations(db));
        for (const column of COLLATED_COLUMNS) {
          expect(collations[column]?.toLowerCase()).toBe(engine.binaryCollation.toLowerCase());
        }
      });

      // For a table without secondary indexes this expects none, which still catches one
      // added by mistake.
      it('upgrade creates the expected secondary indexes over the right columns, in order', async () => {
        await cli('upgrade');

        expect(await introspect((db) => engine.indexes(db))).toEqual(INDEXES);
      });

      it(`upgrade builds the table ${TABLE_NAME_FLAG} asks for, and its own ledger`, async () => {
        const { code } = await cli('upgrade', '--store', STORE_ID, TABLE_NAME_FLAG, RENAMED_TABLE);

        expect(code).toBe(0);
        const names = await tableNames();
        expect(names).toEqual(expect.arrayContaining([RENAMED_TABLE, RENAMED_LEDGER_TABLE]));
        expect(names).not.toContain(TABLE);
        expect(names).not.toContain(LEDGER_TABLE);
        expect((await columnsOf(RENAMED_TABLE)).map((column) => column.name).sort()).toEqual(
          [...ALL_COLUMNS].sort()
        );
      });

      it('upgrade admits a second, differently named deployment to the same database', async () => {
        const first = await cli('upgrade', '--store', STORE_ID, TABLE_NAME_FLAG, RENAMED_TABLE);
        const second = await cli('upgrade', '--store', STORE_ID, TABLE_NAME_FLAG, SECOND_TABLE);

        expect(first.code).toBe(0);
        expect(second.code).toBe(0);
        expect(second.err).toBe('');
        expect(await tableNames()).toEqual(
          expect.arrayContaining([
            RENAMED_TABLE,
            RENAMED_LEDGER_TABLE,
            SECOND_TABLE,
            SECOND_LEDGER_TABLE,
          ])
        );
      });

      it('upgrade twice changes nothing and leaves one ledger row', async () => {
        await cli('upgrade');
        const before = await structure();

        const { code, out } = await cli('upgrade');

        expect(code).toBe(0);
        expect(out).toContain('up to date');
        expect(await structure()).toEqual(before);
        const ledger = await introspect((db) =>
          sql.raw(`select name from ${LEDGER_TABLE}`).execute(db)
        );
        expect(ledger.rows).toHaveLength(1);
      });

      it('status reports the migration as pending before upgrade', async () => {
        const { code, out } = await cli('status');

        expect(code).toBe(0);
        expect(out).toContain(MIGRATION);
        expect(out).toContain('pending');
      });

      it('status reports the migration as applied, with a timestamp', async () => {
        await cli('upgrade');

        const { out } = await cli('status');

        expect(out).toMatch(/applied\s+\d{4}-\d{2}-\d{2}T/);
        expect(out).not.toContain('pending');
      });

      it('status creates no tables on an untouched database', async () => {
        const { code } = await cli('status');

        expect(code).toBe(0);
        const names = await tableNames();
        for (const table of [TABLE, LEDGER_TABLE, LOCK_TABLE]) {
          expect(names).not.toContain(table);
        }
      });

      it('status reports pending again after downgrade', async () => {
        await cli('upgrade');
        await cli('downgrade');

        expect((await cli('status')).out).toContain('pending');
      });

      it('downgrade drops the table and names the reverted migration', async () => {
        await cli('upgrade');

        const { code, out } = await cli('downgrade');

        expect(code).toBe(0);
        expect(out).toContain(`reverted ${MIGRATION}`);
        expect(await tableNames()).not.toContain(TABLE);
      });

      it('downgrade reports nothing to revert when the ledger is empty', async () => {
        await cli('upgrade');
        await cli('downgrade');

        const { code, out } = await cli('downgrade');

        expect(code).toBe(0);
        expect(out).toContain('nothing to revert');
      });

      // "base" is the one target the store does not name: it becomes Kysely's own
      // NO_MIGRATIONS sentinel, which lives behind the same runtime load as the
      // migrator. The table going away is what proves the translation happened.
      it('downgrade base reverts every migration and empties the ledger', async () => {
        await cli('upgrade');

        const { code, out } = await cli('downgrade', BASE);

        expect(code).toBe(0);
        expect(out).toContain(`now at ${BASE}`);
        expect(await tableNames()).not.toContain(TABLE);
        expect((await cli('status')).out).toContain('pending');
      });

      it('downgrade refuses a migration that is not applied, instead of applying it', async () => {
        const { code, err } = await cli('downgrade', MIGRATION, '--store', STORE_ID);

        expect(code).toBe(1);
        expect(err).toContain(`"${MIGRATION}" is not applied to the ${STORE_ID} store`);
        expect(await tableNames()).not.toContain(TABLE);
        expect((await cli('status', '--store', STORE_ID)).out).toContain('pending');
      });

      it('downgrade to an applied migration leaves it applied', async () => {
        await cli('upgrade');

        const { code, out } = await cli('downgrade', MIGRATION, '--store', STORE_ID);

        expect(code).toBe(0);
        expect(out).toContain(`now at ${MIGRATION}`);
        expect(await tableNames()).toContain(TABLE);
      });

      it('upgrade after downgrade recreates an identical table', async () => {
        await cli('upgrade');
        const before = await structure();

        await cli('downgrade');
        await cli('upgrade');

        expect(await structure()).toEqual(before);
      });

      it('a failing migration names the store, the migration and the error', async () => {
        // A table already sitting where the migration wants to create one. The ledger stays
        // empty, so the migration is still pending and runs straight into it.
        await introspect((db) => sql.raw(`create table ${TABLE} (tenant varchar(8))`).execute(db));

        const { code, err } = await cli('upgrade');

        expect(code).toBe(1);
        expect(err).toContain(`store "${STORE_ID}"`);
        expect(err).toContain(MIGRATION);
        // The cause, not just the wrapper: without it the reason is lost.
        expect(err).toMatch(/exist/i);
      });

      /**
       * Renders the script and applies it.
       */
      async function renderAndApply(...args: string[]) {
        const { code, out } = await cli(
          ...args,
          '--sql',
          '--dialect',
          engine.name,
          '--store',
          STORE_ID
        );
        expect(code).toBe(0);

        const statements = out
          .split(';')
          .map((statement) => statement.trim())
          .filter(Boolean);
        await introspect(async (db) => {
          for (const statement of statements) await sql.raw(statement).execute(db);
        });
      }

      describe('--sql', () => {
        it('builds the table a real upgrade builds', async () => {
          await renderAndApply('upgrade');
          expect(await tableNames()).not.toContain(LOCK_TABLE);
          const scripted = await structure();

          await dropTables();
          await cli('upgrade', '--store', STORE_ID);

          expect(scripted).toEqual(await structure());
        });

        it(`renders the table ${TABLE_NAME_FLAG} asks for, and its own ledger`, async () => {
          await renderAndApply('upgrade', TABLE_NAME_FLAG, RENAMED_TABLE);

          const names = await tableNames();
          expect(names).toEqual(expect.arrayContaining([RENAMED_TABLE, RENAMED_LEDGER_TABLE]));
          expect(names).not.toContain(TABLE);
          expect(names).not.toContain(LEDGER_TABLE);
          expect((await columnsOf(RENAMED_TABLE)).map((column) => column.name).sort()).toEqual(
            [...ALL_COLUMNS].sort()
          );
        });

        it('leaves the online CLI reporting the migration applied, with nothing to do', async () => {
          await renderAndApply('upgrade');

          const status = await cli('status', '--store', STORE_ID);
          expect(status.out).toMatch(/applied\s+\d{4}-\d{2}-\d{2}T/);
          expect(status.out).not.toContain('pending');

          const upgrade = await cli('upgrade', '--store', STORE_ID);
          expect(upgrade.code).toBe(0);
          expect(upgrade.out).toContain('up to date');
        });

        /** The reverse of the test above: what a rendered revert leaves behind. */
        it('renders a revert that drops the table and empties the ledger', async () => {
          await cli('upgrade', '--store', STORE_ID);
          expect(await tableNames()).toContain(TABLE);

          await renderAndApply('downgrade', BASE);

          expect(await tableNames()).not.toContain(TABLE);
          const { out } = await cli('status', '--store', STORE_ID);
          expect(out).toContain('pending');
        });

        it('refuses "base" as where a revert starts', async () => {
          const { code, err } = await cli(
            'downgrade',
            BASE,
            '--sql',
            '--dialect',
            engine.name,
            '--store',
            STORE_ID,
            '--from',
            BASE
          );

          expect(code).toBe(1);
          expect(err).toContain('is where a downgrade ends, not where it starts');
        });

        it('refuses "latest" as where a revert stops', async () => {
          const { code, err } = await cli(
            'downgrade',
            LATEST,
            '--sql',
            '--dialect',
            engine.name,
            '--store',
            STORE_ID
          );

          expect(code).toBe(1);
          expect(err).toContain('is where a downgrade starts, not where it stops');
        });
      });
    }
  );
}

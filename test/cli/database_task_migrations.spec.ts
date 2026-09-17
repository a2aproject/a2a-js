import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import { connect } from '../../src/cli/connect.js';
import { run } from '../../src/cli/run.js';

// Spelled out rather than imported from the store: a test that reads these from the code
// it checks cannot catch a rename, and a renamed ledger makes a migrated database look
// untouched.
const STORE_ID = 'tasks';
const TABLE = 'tasks';
const LEDGER_TABLE = 'a2a_task_store_migrations';
const LOCK_TABLE = 'a2a_migrations_lock';
const MIGRATION = '0001_create_tasks';
/** The revision the CLI translates into Kysely's NO_MIGRATIONS. */
const BASE = 'base';
const KEY_COLUMNS = ['tenant', 'owner', 'id'];
const COLLATED_COLUMNS = [...KEY_COLUMNS, 'context_id', 'status_state'];
const ALL_COLUMNS = [
  ...KEY_COLUMNS,
  'context_id',
  'status_last_updated',
  'status_state',
  'status',
  'artifacts',
  'history',
  'metadata',
  'protocol_version',
];

/** The listing indexes, and the column order the keyset pagination depends on. */
const INDEXES: Record<string, string[]> = {
  tasks_scope_updated_idx: ['tenant', 'owner', 'status_last_updated', 'id'],
  tasks_scope_context_updated_idx: ['tenant', 'owner', 'context_id', 'status_last_updated', 'id'],
};

// `upgrade` with no --store migrates every registered store, so the teardown has to
// clear the push notification store's tables too or they outlive the test on a shared server.
const OTHER_STORE_TABLES = ['push_notification_configs', 'a2a_push_notification_store_migrations'];

/**
 * What differs between engines: how to reach a database, how the binary collation is
 * spelled, and how to read back the four things Kysely's portable introspector does not
 * expose — width, collation, position in the key, and the secondary indexes.
 */
interface Engine {
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

const tempDirs: string[] = [];

const sqliteEngine: Engine = {
  name: 'sqlite',
  binaryCollation: 'binary',
  freshUrl() {
    const dir = mkdtempSync(join(tmpdir(), 'a2a-task-migrations-'));
    tempDirs.push(dir);
    return `sqlite:${join(dir, 'a2a.db')}`;
  },
  async widths(db) {
    // SQLite stores the declared type verbatim and never enforces it, so the width is
    // read back out of that string rather than from a limit the engine applies.
    const rows = await query(db, `PRAGMA table_info(${TABLE})`);
    return Object.fromEntries(
      rows
        .map((row) => [String(row.name), /varchar\((\d+)\)/i.exec(String(row.type))?.[1]] as const)
        .filter(([, width]) => width !== undefined)
        .map(([name, width]) => [name, Number(width)])
    );
  },
  async collations(db) {
    // Read out of the stored DDL rather than the indexes: `PRAGMA index_xinfo` reports a
    // collation only for indexed columns, and `status_state` is in no index.
    const [table] = await query(
      db,
      `select sql from sqlite_master where type = 'table' and name = '${TABLE}'`
    );
    const collations: Record<string, string> = {};
    for (const [, column, collation] of String(table?.sql ?? '').matchAll(
      /"(\w+)"\s+\w+(?:\(\d+\))?\s+collate\s+(\w+)/gi
    )) {
      collations[column] = collation;
    }
    return collations;
  },
  async keyOrder(db) {
    const rows = await query(db, `PRAGMA table_info(${TABLE})`);
    return rows
      .filter((row) => Number(row.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((row) => String(row.name));
  },
  async indexes(db) {
    const indexes: Record<string, string[]> = {};
    for (const index of await query(db, `PRAGMA index_list(${TABLE})`)) {
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

/** PostgreSQL and MySQL are read the same way, differing only in these. */
const SERVERS = [
  {
    name: 'postgres',
    variable: 'POSTGRES_TEST_DSN',
    binaryCollation: 'C',
    currentSchema: 'current_schema()',
    indexesSql: `
      select i.relname as index_name, a.attname as column_name
      from pg_class t
      join pg_index ix on ix.indrelid = t.oid
      join pg_class i on i.oid = ix.indexrelid
      cross join lateral unnest(ix.indkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      where t.relname = '${TABLE}' and not ix.indisprimary
      order by i.relname, k.ord`,
  },
  {
    name: 'mysql',
    variable: 'MYSQL_TEST_DSN',
    binaryCollation: 'utf8mb4_0900_bin',
    currentSchema: 'database()',
    indexesSql: `
      select index_name, column_name
      from information_schema.statistics
      where table_name = '${TABLE}' and table_schema = database() and index_name <> 'PRIMARY'
      order by index_name, seq_in_index`,
  },
] as const;

function informationSchemaEngine(server: (typeof SERVERS)[number], url: string): Engine {
  const { name, binaryCollation, currentSchema, indexesSql } = server;
  const scoped = `table_name = '${TABLE}' and table_schema = ${currentSchema}`;
  return {
    name,
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
         where k.table_name = '${TABLE}' and k.table_schema = ${currentSchema}
           and c.constraint_type = 'PRIMARY KEY'
         order by k.ordinal_position`
      );
      return rows.map((row) => String(row.column_name));
    },
    async indexes(db) {
      return groupIndexColumns(await query(db, indexesSql));
    },
  };
}

/**
 * Set where every engine is meant to be reachable, so a misconfigured job fails instead
 * of quietly proving only that SQLite works. The variable names live here rather than in
 * the workflow, so renaming one cannot leave CI passing against fewer engines.
 */
const REQUIRE_EVERY_ENGINE = process.env.A2A_TEST_REQUIRE_ALL_ENGINES === '1';

/** SQLite needs nothing; a server engine joins in only once pointed at a database. */
const ENGINES: Engine[] = [sqliteEngine];
const UNCONFIGURED: string[] = [];

for (const server of SERVERS) {
  const url = process.env[server.variable];
  if (url !== undefined) {
    ENGINES.push(informationSchemaEngine(server, url));
  } else if (REQUIRE_EVERY_ENGINE) {
    throw new Error(
      `${server.variable} is not set, but A2A_TEST_REQUIRE_ALL_ENGINES demands every engine.`
    );
  } else {
    UNCONFIGURED.push(`${server.name} (${server.variable} not set)`);
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Reported rather than dropped, so a run against fewer engines than intended is visible.
for (const label of UNCONFIGURED) {
  describe.skip(`a2a-db task migrations on ${label}`, () => {
    it('has no database to run against', () => {});
  });
}

for (const engine of ENGINES) {
  describe(`a2a-db task migrations on ${engine.name}`, () => {
    let url: string;

    /**
     * Every read opens its own connection, because the CLI does its work on a different
     * one. SQLite answers `PRAGMA index_list` out of a schema cached when the connection
     * opened, so a connection older than the migration reports no indexes at all.
     */
    async function introspect<T>(read: (db: Kysely<unknown>) => Promise<T>): Promise<T> {
      const db = await connect(url);
      try {
        return await read(db);
      } finally {
        await db.destroy();
      }
    }

    beforeEach(async () => {
      url = engine.freshUrl();
      // SQLite gets a new file each time; the shared servers need the last run cleared.
      await introspect(async (db) => {
        for (const table of [TABLE, LEDGER_TABLE, LOCK_TABLE, ...OTHER_STORE_TABLES]) {
          await sql.raw(`drop table if exists ${table}`).execute(db);
        }
      });
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

    const columnsOf = () =>
      introspect(
        async (db) =>
          (await db.introspection.getTables()).find((table) => table.name === TABLE)?.columns ?? []
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
      expect(await tableNames()).toEqual(expect.arrayContaining([TABLE, LEDGER_TABLE, LOCK_TABLE]));
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
      for (const column of [...KEY_COLUMNS, 'context_id', 'status_last_updated']) {
        expect(nullable[column]).toBe(false);
      }
      for (const column of ['status_state', 'status', 'artifacts', 'history', 'metadata']) {
        expect(nullable[column]).toBe(true);
      }
      expect(nullable.protocol_version).toBe(true);
    });

    it('upgrade sets the expected width on every varchar column', async () => {
      await cli('upgrade');

      const widths = await introspect((db) => engine.widths(db));
      expect(widths.tenant).toBe(255);
      expect(widths.owner).toBe(255);
      expect(widths.id).toBe(36);
      expect(widths.context_id).toBe(36);
      expect(widths.status_state).toBe(255);
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

    it('upgrade creates both listing indexes over the right columns, in order', async () => {
      await cli('upgrade');

      expect(await introspect((db) => engine.indexes(db))).toEqual(INDEXES);
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
  });
}

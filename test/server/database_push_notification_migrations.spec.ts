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
const STORE_ID = 'push-notification-configs';
const TABLE = 'push_notification_configs';
const LEDGER_TABLE = 'a2a_push_notification_store_migrations';
const LOCK_TABLE = 'a2a_migrations_lock';
const MIGRATION = '0001_create_push_notification_configs';
const KEY_COLUMNS = ['tenant', 'owner', 'task_id', 'config_id'];
const ALL_COLUMNS = [...KEY_COLUMNS, 'config_data', 'protocol_version'];

/**
 * What differs between engines: how to reach a database, how the binary collation is
 * spelled, and how to read back the three things Kysely's portable introspector does not
 * expose — width, collation and position in the key.
 */
interface Engine {
  readonly name: string;
  /** The collation the key columns must carry here, spelled this engine's way. */
  readonly binaryCollation: string;
  /** A URL whose database holds none of this store's tables. */
  freshUrl(): string;
  widths(db: Kysely<unknown>): Promise<Record<string, number>>;
  collations(db: Kysely<unknown>): Promise<Record<string, string | null>>;
  keyOrder(db: Kysely<unknown>): Promise<string[]>;
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

const tempDirs: string[] = [];

const sqliteEngine: Engine = {
  name: 'sqlite',
  binaryCollation: 'binary',
  freshUrl() {
    const dir = mkdtempSync(join(tmpdir(), 'a2a-migrations-'));
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
    // The key columns are the primary key, so their collations are the ones on the index
    // SQLite builds for it.
    const indexes = await query(db, `PRAGMA index_list(${TABLE})`);
    const primary = indexes.find((row) => row.origin === 'pk');
    if (!primary) return {};
    const columns = await query(db, `PRAGMA index_xinfo('${String(primary.name)}')`);
    return Object.fromEntries(
      columns
        // The trailing rowid entry is not a key column.
        .filter((row) => Number(row.key) === 1)
        .map((row) => [String(row.name), String(row.coll)])
    );
  },
  async keyOrder(db) {
    const rows = await query(db, `PRAGMA table_info(${TABLE})`);
    return rows
      .filter((row) => Number(row.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((row) => String(row.name));
  },
};

/** PostgreSQL and MySQL are read the same way, differing only in these. */
const SERVERS = [
  {
    name: 'postgres',
    variable: 'POSTGRES_TEST_DSN',
    binaryCollation: 'C',
    currentSchema: 'current_schema()',
  },
  {
    name: 'mysql',
    variable: 'MYSQL_TEST_DSN',
    binaryCollation: 'utf8mb4_0900_bin',
    currentSchema: 'database()',
  },
] as const;

function informationSchemaEngine(server: (typeof SERVERS)[number], url: string): Engine {
  const { name, binaryCollation, currentSchema } = server;
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
  describe.skip(`a2a-db push notification migrations on ${label}`, () => {
    it('has no database to run against', () => {});
  });
}

for (const engine of ENGINES) {
  describe(`a2a-db push notification migrations on ${engine.name}`, () => {
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
        for (const table of [TABLE, LEDGER_TABLE, LOCK_TABLE]) {
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
      for (const column of KEY_COLUMNS) expect(nullable[column]).toBe(false);
      expect(nullable.config_data).toBe(true);
      expect(nullable.protocol_version).toBe(true);
    });

    it('upgrade sets the expected width on every key column', async () => {
      await cli('upgrade');

      const widths = await introspect((db) => engine.widths(db));
      expect(widths.task_id).toBe(36);
      expect(widths.config_id).toBe(36);
      expect(widths.tenant).toBe(255);
      expect(widths.owner).toBe(255);
    });

    it('upgrade sets the primary key to the key columns, in order', async () => {
      await cli('upgrade');

      expect(await introspect((db) => engine.keyOrder(db))).toEqual(KEY_COLUMNS);
    });

    it('upgrade sets the binary collation on every key column', async () => {
      await cli('upgrade');

      const collations = await introspect((db) => engine.collations(db));
      for (const column of KEY_COLUMNS) {
        expect(collations[column]?.toLowerCase()).toBe(engine.binaryCollation.toLowerCase());
      }
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

import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect } from 'kysely';
import type { Dialect, MysqlPool, PostgresPool, SqliteDatabase } from 'kysely';

/**
 * The URL schemes the CLI understands, and the driver each one needs.
 * `postgres` and `postgresql` are both official.
 */
const DRIVERS = {
  postgres: 'pg',
  postgresql: 'pg',
  mysql: 'mysql2',
  sqlite: 'better-sqlite3',
} as const satisfies Readonly<Record<string, string>>;

type Scheme = keyof typeof DRIVERS;

function schemeOf(url: string): Scheme {
  const colon = url.indexOf(':');
  // `<= 0` is both "no colon" and a leading one.
  if (colon <= 0) {
    throw new Error(
      `Missing scheme in database URL "${url}". Expected something like ` +
        `postgresql://host/db, mysql://host/db, or sqlite:./a2a.db.`
    );
  }

  const scheme = url.slice(0, colon).toLowerCase();
  if (scheme in DRIVERS) return scheme as Scheme;
  throw new Error(
    `Unsupported database URL scheme "${scheme}". ` +
      `Expected one of: ${Object.keys(DRIVERS).join(', ')}.`
  );
}

/**
 * Imports an optional driver by name.
 */
async function loadDriver(scheme: Scheme): Promise<Record<string, unknown>> {
  const name = DRIVERS[scheme];
  try {
    return (await import(name)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `A ${scheme}: URL needs the "${name}" package, which could not be loaded.\n` +
        `${String(error)}\n` +
        `If it is missing: npm install ${name}`,
      { cause: error }
    );
  }
}

/** For SQLite, return the file path. */
function filePath(url: string): string {
  const path = url.slice(url.indexOf(':') + 1).replace(/^\/\//, '');
  // better-sqlite3 reads an empty path as a private temporary database, so migrating one
  // would report success and leave nothing behind.
  if (path === '') {
    throw new Error(`No file in SQLite URL "${url}". Expected something like sqlite:./a2a.db.`);
  }
  return path;
}

/**
 * Migrations run on a single connection, so a pool of the driver's default
 * size would only open connections nothing uses.
 */
const POOL_SIZE = 1;

/**
 * pg leaves this unset, which means an unreachable host hangs rather than failing.
 * mysql2 already defaults connectTimeout to 10s.
 */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * The part of each driver we actually use, typed as the interface Kysely expects.
 */
type PgModule = {
  Pool: new (config: {
    connectionString: string;
    max: number;
    connectionTimeoutMillis: number;
  }) => PostgresPool;
};

type MysqlModule = {
  createPool: (config: { uri: string; connectionLimit: number }) => MysqlPool;
};

type BetterSqliteModule = {
  default: new (path: string) => SqliteDatabase;
};

/** Builds the Kysely dialect a database URL calls for, loading its driver on demand. */
async function dialectFor(url: string): Promise<Dialect> {
  const scheme = schemeOf(url);
  const driver = await loadDriver(scheme);

  switch (scheme) {
    case 'postgres':
    case 'postgresql': {
      const { Pool } = driver as PgModule;
      return new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          max: POOL_SIZE,
          connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
        }),
      });
    }
    case 'mysql': {
      const { createPool } = driver as MysqlModule;
      return new MysqlDialect({ pool: createPool({ uri: url, connectionLimit: POOL_SIZE }) });
    }
    case 'sqlite': {
      const { default: Database } = driver as BetterSqliteModule;
      return new SqliteDialect({ database: new Database(filePath(url)) });
    }
  }
}

/** A connection to the database the URL names. The caller owns it and must destroy it. */
export async function connect(url: string): Promise<Kysely<unknown>> {
  return new Kysely<unknown>({ dialect: await dialectFor(url) });
}

// The engines the Node database suites run against. D1 has suites of its own under
// test/edge/, which cannot import this: it needs Node built-ins.
import { afterEach, describe, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Kysely } from 'kysely';

import { connect } from '../../../src/cli/connect.js';

/** The database servers a suite also runs against, each once its variable holds a URL. */
export const SERVERS = [
  { name: 'postgres', variable: 'POSTGRES_TEST_DSN' },
  { name: 'mysql', variable: 'MYSQL_TEST_DSN' },
] as const;

export type Server = (typeof SERVERS)[number];

/** What differs between engines, for a suite that needs nothing but a way to connect. */
export interface Engine {
  readonly name: string;
  freshUrl(): string;
}

/**
 * Set where every engine is meant to be reachable, so a misconfigured job fails instead
 * of quietly proving only that SQLite works. The variable names live here rather than in
 * the workflow, so renaming one cannot leave CI passing against fewer engines.
 */
const REQUIRE_EVERY_ENGINE = process.env.A2A_TEST_REQUIRE_ALL_ENGINES === '1';

/**
 * Declares `suite` as `<title> on <engine>` for SQLite, and for each server whose variable
 * is set. A server without one is reported as a skipped suite rather than dropped, so a
 * run against fewer engines than intended is visible.
 */
export function describeOnEachEngine<E extends { readonly name: string }>(
  title: string,
  sqlite: E,
  serverEngine: (server: Server, url: string) => E,
  suite: (engine: E) => void
): void {
  const engines = [sqlite];
  for (const server of SERVERS) {
    const url = process.env[server.variable];
    if (url !== undefined) {
      engines.push(serverEngine(server, url));
    } else if (REQUIRE_EVERY_ENGINE) {
      throw new Error(
        `${server.variable} is not set, but A2A_TEST_REQUIRE_ALL_ENGINES demands every engine.`
      );
    } else {
      describe.skip(`${title} on ${server.name} (${server.variable} not set)`, () => {
        it('has no database to run against', () => {});
      });
    }
  }
  for (const engine of engines) {
    describe(`${title} on ${engine.name}`, () => suite(engine));
  }
}

/** A server engine for a suite that only needs to connect. */
export function urlOnly(server: Server, url: string): Engine {
  // The server already exists; unlike SQLite there is no new one to make per test.
  return { name: server.name, freshUrl: () => url };
}

/** Returns a function handing out a new SQLite file per call, each deleted after its test. */
export function freshSqliteUrl(prefix: string): () => string {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  return () => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return `sqlite:${join(dir, 'a2a.db')}`;
  };
}

/** Runs `use` on a connection of its own, as an operator's migration step would have. */
export async function withConnection<T>(
  url: string,
  use: (db: Kysely<unknown>) => Promise<T>
): Promise<T> {
  const connection = await connect(url);
  try {
    return await use(connection);
  } finally {
    await connection.destroy();
  }
}

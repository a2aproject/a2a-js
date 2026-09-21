import {
  DummyDriver,
  Kysely,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from 'kysely';
import type { CompiledQuery } from 'kysely';

import type { DialectName } from '../server/database/dialect.js';

/**
 * The parts of a dialect that shape SQL, minus the part that would connect.
 * Typed as a complete `Record`, so a new {@link DialectName} cannot be added without one.
 */
const PARTS = {
  postgres: [PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler],
  mysql: [MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler],
  sqlite: [SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler],
} as const satisfies Record<DialectName, unknown>;

/** Every engine `--sql` can write for. */
export const DIALECT_NAMES = Object.keys(PARTS) as readonly DialectName[];

/**
 * A Kysely that writes an engine's SQL but reaches no database, keeping every statement
 * it is asked to run.
 *
 * Both halves are Kysely's own: `DummyDriver` is what it ships for compiling without a
 * connection, and `log` reports each compiled query from the layer above the driver, so
 * nothing here has to stand in for one. Every query answers with no rows, which is why
 * only migrations that just write can be rendered.
 */
export function recordingKysely<DB>(dialect: DialectName): {
  db: Kysely<DB>;
  recorded: readonly CompiledQuery[];
} {
  const [Adapter, Introspector, Compiler] = PARTS[dialect];
  const recorded: CompiledQuery[] = [];

  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new Adapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (instance: Kysely<DB>) => new Introspector(instance),
      createQueryCompiler: () => new Compiler(),
    },
    log: (event) => {
      if (event.level === 'query') recorded.push(event.query);
    },
  });

  return { db, recorded };
}

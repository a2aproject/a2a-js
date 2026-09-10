import { MysqlIntrospector, PostgresIntrospector, SqliteIntrospector, sql } from 'kysely';
import type { Kysely } from 'kysely';

/** The supported database engines. */
export type DialectName = 'postgres' | 'mysql' | 'sqlite';

/**
 * Each dialect supplies its own introspector class and `db.introspection` is public.
 * Throws for anything else.
 */
export function dialectOf<DB>(db: Kysely<DB>): DialectName {
  const introspector = db.introspection;

  if (introspector instanceof PostgresIntrospector) return 'postgres';
  if (introspector instanceof MysqlIntrospector) return 'mysql';
  if (introspector instanceof SqliteIntrospector) return 'sqlite';

  // `instanceof` compares class identity, so a second kysely in the install tree fails
  // every check above against classes that are otherwise identical. The name recovers
  // that, but not a build that minifies kysely itself.
  const name = introspector.constructor?.name ?? '<unknown>';
  if (name === 'PostgresIntrospector') return 'postgres';
  if (name === 'MysqlIntrospector') return 'mysql';
  if (name === 'SqliteIntrospector') return 'sqlite';

  throw new Error(
    `@a2a-js/sdk database stores support PostgreSQL, MySQL and SQLite. This Kysely ` +
      `instance uses ${name}, which is none of them.`
  );
}

/**
 * Only MySQL by default doesn't use case- and accent-sensitivity.
 * Specific types have to be used to ensure the same behavior across engines.
 */
const COLLATION: Readonly<Record<DialectName, string>> = {
  postgres: 'collate "C"',
  mysql: 'collate utf8mb4_0900_bin',
  sqlite: 'collate binary',
};

/**
 * A `varchar(n)` carrying the engine's collation.
 * `sql.raw` because Kysely validates column types at runtime too - casting to
 * 'ColumnDataType' compiles but then throws 'invalid column data type' at runtime.
 */
export function collatedVarchar(dialect: DialectName, length: number) {
  return sql.raw(`varchar(${length}) ${COLLATION[dialect]}`);
}

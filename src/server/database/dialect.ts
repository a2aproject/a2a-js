import { MysqlIntrospector, PostgresIntrospector, SqliteIntrospector } from 'kysely';
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

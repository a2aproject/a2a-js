import { sql } from 'kysely';
import type { Kysely, RawBuilder } from 'kysely';

import { dialectOf, type DialectName } from '../../../server/database/dialect.js';
import type { MigrationModule } from '../../store_migrations.js';

/** Only needed while backfilling: an unreadable payload must remain skippable. */
async function safeTimestampFunction(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function pg_temp.a2a_status_timestamp(payload text, updated bigint) returns text
    language plpgsql as $$
    declare value text;
    begin
      value := payload::json ->> 'timestamp';
      if updated = 0 then perform value::timestamptz; end if;
      return value;
    exception when data_exception then
      return null;
    end;
    $$
  `.execute(db);
}

/** Frozen SQL: old rows retain their payload and millisecond metadata verbatim. */
function backfillNanos(dialect: DialectName): RawBuilder<number> {
  const timestamp = sql.raw(
    dialect === 'postgres'
      ? 'pg_temp.a2a_status_timestamp(status, status_last_updated)'
      : dialect === 'mysql'
        ? "case when json_valid(status) then json_unquote(json_extract(status, '$.timestamp')) end"
        : "case when json_valid(status) then json_extract(status, '$.timestamp') end"
  );
  // RFC3339's date and time occupy 19 characters. Only the zone's width varies.
  const fraction = sql`substr(${timestamp}, 21,
    length(${timestamp}) - case when lower(substr(${timestamp}, length(${timestamp}), 1)) = 'z' then 21 else 26 end)`;
  const digits =
    dialect === 'postgres'
      ? sql`${fraction} ~ '^[0-9]{1,9}$'`
      : dialect === 'mysql'
        ? sql`${fraction} regexp '^[0-9]{1,9}$'`
        : sql`length(${fraction}) between 1 and 9 and ${fraction} not glob '*[^0-9]*'`;
  const padded =
    dialect === 'sqlite'
      ? sql`substr(${fraction} || '000000000', 1, 9)`
      : sql`rpad(${fraction}, 9, '0')`;
  // Zero also represents Date.parse failures. Do not give those historical rows
  // precision that a new save would discard; valid epoch timestamps still qualify.
  const valid =
    dialect === 'sqlite'
      ? sql`status_last_updated <> 0 or julianday(${timestamp}) is not null`
      : dialect === 'mysql'
        ? sql`status_last_updated <> 0 or ${timestamp} regexp
          '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])[Tt]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{1,9}([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'`
        : sql`true`;
  const integer = sql.raw(dialect === 'mysql' ? 'unsigned' : 'integer');
  return sql<number>`case when substr(${timestamp}, 20, 1) = '.' and ${digits} and (${valid})
    then cast(substr(${padded}, 4, 6) as ${integer}) else 0 end`;
}

/** Keep the original index names and include the new part of the key. */
async function replaceIndexes(db: Kysely<unknown>, tableName: string, precise: boolean) {
  for (const context of [false, true]) {
    const name = `${tableName}_scope_${context ? 'context_' : ''}updated_idx`;
    const drop = db.schema.dropIndex(name);
    await (dialectOf(db) === 'mysql' ? drop.on(tableName) : drop).execute();
    await db.schema
      .createIndex(name)
      .on(tableName)
      .columns([
        'tenant',
        'owner',
        ...(context ? ['context_id'] : []),
        'status_last_updated',
        ...(precise ? ['status_last_updated_nanos'] : []),
        'id',
      ])
      .execute();
  }
}

export function addTimestampPrecision(tableName: string): MigrationModule {
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      const dialect = dialectOf(db);
      await db.schema
        .alterTable(tableName)
        .addColumn('status_last_updated_nanos', 'integer', (column) =>
          column.notNull().defaultTo(0)
        )
        .execute();

      if (dialect === 'postgres') await safeTimestampFunction(db);
      try {
        await sql`update ${sql.table(tableName)} set status_last_updated_nanos = ${backfillNanos(dialect)}`.execute(
          db
        );
      } finally {
        if (dialect === 'postgres') {
          await sql`drop function pg_temp.a2a_status_timestamp(text, bigint)`.execute(db);
        }
      }
      await replaceIndexes(db, tableName, true);
    },

    async down(db: Kysely<unknown>): Promise<void> {
      await replaceIndexes(db, tableName, false);
      await db.schema.alterTable(tableName).dropColumn('status_last_updated_nanos').execute();
    },
  };
}

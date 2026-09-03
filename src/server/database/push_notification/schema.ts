import type { Kysely } from 'kysely';

import { collatedVarchar, dialectOf } from '../dialect.js';

/**
 * Name of the push notification config table. For now, fixed, not configurable.
 */
export const PUSH_NOTIFICATION_CONFIGS_TABLE = 'push_notification_configs';

/**
 * Row shape of the push notification config table.
 */
export interface PushNotificationConfigRow {
  tenant: string;
  owner: string;
  task_id: string;
  config_id: string;
  config_data: string | null;
  protocol_version: string | null;
}

/**
 * The schema this store owns.
 * Kysely resolves column names against this at compile time.
 */
export type PushNotificationDatabase = Record<
  typeof PUSH_NOTIFICATION_CONFIGS_TABLE,
  PushNotificationConfigRow
>;

/**
 * The primary key: the caller's scope plus the config's own identity.
 */
export const PUSH_NOTIFICATION_CONFIG_KEY_COLUMNS = [
  'tenant',
  'owner',
  'task_id',
  'config_id',
] as const satisfies readonly (keyof PushNotificationConfigRow)[];

/**
 * The `CREATE TABLE`.
 */
export function pushNotificationConfigsTableStatement(db: Kysely<PushNotificationDatabase>) {
  // All four key columns are compared for equality, so all four need the engine's
  // collation.
  const dialect = dialectOf(db);
  const varchar255 = collatedVarchar(dialect, 255);
  const varchar36 = collatedVarchar(dialect, 36);

  return db.schema
    .createTable(PUSH_NOTIFICATION_CONFIGS_TABLE)
    .addColumn('tenant', varchar255, (column) => column.notNull())
    .addColumn('owner', varchar255, (column) => column.notNull())
    .addColumn('task_id', varchar36, (column) => column.notNull())
    .addColumn('config_id', varchar36, (column) => column.notNull())
    .addColumn('config_data', 'text')
    .addColumn('protocol_version', 'varchar(255)')
    .addPrimaryKeyConstraint('push_notification_configs_pkey', [
      ...PUSH_NOTIFICATION_CONFIG_KEY_COLUMNS,
    ]);
}

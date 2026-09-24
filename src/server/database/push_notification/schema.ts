/**
 * Name of the push notification table, unless the store's `tableName` option names
 * another.
 */
export const PUSH_NOTIFICATION_TABLE = 'push_notification_configs';

/**
 * Row shape of the push notification table.
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
export type PushNotificationDatabase = Record<string, PushNotificationConfigRow>;

/**
 * The primary key: the caller's scope plus the config's own identity.
 */
export const PUSH_NOTIFICATION_TABLE_KEY_COLUMNS = [
  'tenant',
  'owner',
  'task_id',
  'config_id',
] as const satisfies readonly (keyof PushNotificationConfigRow)[];

export const PUSH_NOTIFICATION_TABLE_COLUMNS = [
  ...PUSH_NOTIFICATION_TABLE_KEY_COLUMNS,
  'config_data',
  'protocol_version',
] as const satisfies readonly (keyof PushNotificationConfigRow)[];

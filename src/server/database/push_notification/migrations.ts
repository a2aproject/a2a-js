import { ledgerTableFor, type StoreMigrations } from '../store_migrations.js';

import { createPushNotificationConfigs } from './migrations/0001_create_push_notification_configs.js';
import { PUSH_NOTIFICATION_TABLE } from './schema.js';

/** Names this store on the command line. */
export const PUSH_NOTIFICATION_STORE_ID = 'push-notification-configs';

/**
 * This store's migrations, built for the table it is given. It must be the table
 * `DatabasePushNotificationStore` was given too, or the store reads a table nothing
 * created.
 */
export function pushNotificationStoreMigrations(
  tableName: string = PUSH_NOTIFICATION_TABLE
): StoreMigrations {
  return {
    id: PUSH_NOTIFICATION_STORE_ID,
    ledgerTable: ledgerTableFor(tableName),
    migrations: {
      '0001_create_push_notification_configs': createPushNotificationConfigs(tableName),
    },
  };
}

import type { StoreMigrations } from '../migrator.js';

import * as createPushNotificationConfigs from './migrations/0001_create_push_notification_configs.js';

export const PUSH_NOTIFICATION_STORE_MIGRATIONS: StoreMigrations = {
  id: 'push-notification',
  ledgerTable: 'a2a_push_notification_store_migrations',
  lockTable: 'a2a_push_notification_store_migrations_lock',
  migrations: {
    '0001_create_push_notification_configs': createPushNotificationConfigs,
  },
};

import type { StoreMigrations } from '../store_migrations.js';

import * as createPushNotificationConfigs from './migrations/0001_create_push_notification_configs.js';

export const PUSH_NOTIFICATION_STORE_MIGRATIONS: StoreMigrations = {
  id: 'push-notification-configs',
  ledgerTable: 'a2a_push_notification_store_migrations',
  migrations: {
    '0001_create_push_notification_configs': createPushNotificationConfigs,
  },
};

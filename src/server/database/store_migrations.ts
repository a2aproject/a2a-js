import type { StoreMigrations } from './migrator.js';
import { PUSH_NOTIFICATION_STORE_MIGRATIONS } from './push_notification/migrations.js';

/**
 * Every store `a2a-db` manages.
 */
export const ALL_STORE_MIGRATIONS: readonly StoreMigrations[] = [
  PUSH_NOTIFICATION_STORE_MIGRATIONS,
];

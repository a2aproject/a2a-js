import type { StoreMigrations } from '../store_migrations.js';

import * as createTasks from './migrations/0001_create_tasks.js';

export const TASK_STORE_MIGRATIONS: StoreMigrations = {
  id: 'tasks',
  ledgerTable: 'a2a_task_store_migrations',
  migrations: {
    '0001_create_tasks': createTasks,
  },
};

import { TASK_TABLE } from '../../server/database/task/schema.js';
import { ledgerTableFor, type StoreMigrations } from '../store_migrations.js';

import { createTasks } from './migrations/0001_create_tasks.js';
import { addTaskGeneration } from './migrations/0002_add_task_generation.js';
import { addTaskTimeline } from './migrations/0003_add_task_timeline.js';

/** Names this store on the command line. */
export const TASK_STORE_ID = 'tasks';

/**
 * This store's migrations, built for the table it is given. It must be the table
 * `DatabaseTaskStore` was given too, or the store reads a table nothing created.
 */
export function taskStoreMigrations(tableName: string = TASK_TABLE): StoreMigrations {
  return {
    id: TASK_STORE_ID,
    ledgerTable: ledgerTableFor(tableName),
    migrations: {
      '0001_create_tasks': createTasks(tableName),
      '0002_add_task_generation': addTaskGeneration(tableName),
      '0003_add_task_timeline': addTaskTimeline(tableName),
    },
  };
}

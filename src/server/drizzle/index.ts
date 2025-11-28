/**
 * Drizzle ORM integration for persistent task storage.
 *
 * This module provides a database-backed implementation of the TaskStore interface
 * using Drizzle ORM, supporting PostgreSQL, MySQL, and SQLite databases.
 *
 * @example
 * ```typescript
 * // SQLite example
 * import { drizzle } from 'drizzle-orm/better-sqlite3';
 * import Database from 'better-sqlite3';
 * import { DatabaseTaskStore, sqliteTasks } from '@a2a-js/sdk/server/drizzle';
 *
 * const sqlite = new Database('tasks.db');
 * const db = drizzle(sqlite);
 *
 * const taskStore = new DatabaseTaskStore({
 *   db,
 *   table: sqliteTasks,
 *   dialect: 'sqlite',
 * });
 * ```
 *
 * @example
 * ```typescript
 * // PostgreSQL example
 * import { drizzle } from 'drizzle-orm/node-postgres';
 * import { Pool } from 'pg';
 * import { DatabaseTaskStore, pgTasks } from '@a2a-js/sdk/server/drizzle';
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const db = drizzle(pool);
 *
 * const taskStore = new DatabaseTaskStore({
 *   db,
 *   table: pgTasks,
 *   dialect: 'postgresql',
 * });
 * ```
 */

export { DatabaseTaskStore } from './database_task_store.js';
export type { DrizzleDatabase, DatabaseTaskStoreOptions } from './database_task_store.js';

export { sqliteTasks, pgTasks, mysqlTasks } from './schema.js';
export type { SqliteTasksTable, PgTasksTable, MysqlTasksTable, TasksTable } from './schema.js';

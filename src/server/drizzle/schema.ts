/**
 * Drizzle ORM schema for persistent task storage.
 * This schema defines the tasks table used by DatabaseTaskStore.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { pgTable, text as pgText, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { mysqlTable, text as mysqlText, json, timestamp as mysqlTimestamp } from 'drizzle-orm/mysql-core';
import type { TaskStatus, Artifact, Message1 } from '../../types.js';

/**
 * SQLite tasks table schema.
 * Stores task data with JSON columns for complex nested objects.
 */
export const sqliteTasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  contextId: text('context_id').notNull(),
  kind: text('kind').notNull().$type<'task'>(),
  status: text('status', { mode: 'json' }).notNull().$type<TaskStatus>(),
  artifacts: text('artifacts', { mode: 'json' }).$type<Artifact[] | null>(),
  history: text('history', { mode: 'json' }).$type<Message1[] | null>(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

/**
 * PostgreSQL tasks table schema.
 * Uses JSONB for efficient JSON storage and querying.
 */
export const pgTasks = pgTable('tasks', {
  id: pgText('id').primaryKey(),
  contextId: pgText('context_id').notNull(),
  kind: pgText('kind').notNull().$type<'task'>(),
  status: jsonb('status').notNull().$type<TaskStatus>(),
  artifacts: jsonb('artifacts').$type<Artifact[] | null>(),
  history: jsonb('history').$type<Message1[] | null>(),
  metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * MySQL tasks table schema.
 * Uses JSON columns for complex nested objects.
 */
export const mysqlTasks = mysqlTable('tasks', {
  id: mysqlText('id').primaryKey(),
  contextId: mysqlText('context_id').notNull(),
  kind: mysqlText('kind').notNull().$type<'task'>(),
  status: json('status').notNull().$type<TaskStatus>(),
  artifacts: json('artifacts').$type<Artifact[] | null>(),
  history: json('history').$type<Message1[] | null>(),
  metadata: json('metadata').$type<Record<string, unknown> | null>(),
  createdAt: mysqlTimestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: mysqlTimestamp('updated_at', { mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SqliteTasksTable = typeof sqliteTasks;
export type PgTasksTable = typeof pgTasks;
export type MysqlTasksTable = typeof mysqlTasks;
export type TasksTable = SqliteTasksTable | PgTasksTable | MysqlTasksTable;

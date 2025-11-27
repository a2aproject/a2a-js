/**
 * DatabaseTaskStore - A persistent task store implementation using Drizzle ORM.
 *
 * This module provides a database-backed implementation of the TaskStore interface,
 * supporting PostgreSQL, MySQL, and SQLite databases through Drizzle ORM.
 *
 * @example
 * ```typescript
 * import { drizzle } from 'drizzle-orm/better-sqlite3';
 * import Database from 'better-sqlite3';
 * import { DatabaseTaskStore, sqliteTasks } from '@a2a-js/sdk/server/drizzle';
 *
 * const sqlite = new Database('tasks.db');
 * const db = drizzle(sqlite);
 *
 * const taskStore = new DatabaseTaskStore(db, sqliteTasks);
 * ```
 */
import { eq, type InferSelectModel } from 'drizzle-orm';
import type { Task } from '../../types.js';
import type { TaskStore } from '../store.js';
import type { SqliteTasksTable, PgTasksTable, MysqlTasksTable } from './schema.js';

/**
 * Union type for all supported Drizzle database instances.
 * Supports any Drizzle database that has select, insert, and delete methods.
 *
 * This type is intentionally broad to accommodate different Drizzle dialects
 * (SQLite, PostgreSQL, MySQL) which have slightly different method signatures.
 */
export type DrizzleDatabase = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select: () => SelectQueryBuilder<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insert: <TTable = any>(table: TTable) => InsertQueryBuilder;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete: <TTable = any>(table: TTable) => DeleteQueryBuilder;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SelectQueryBuilder<TTable = any> = {
  from: (table: TTable) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: <TCondition>(condition: TCondition) => Promise<any[]>;
  };
};

type InsertQueryBuilder = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values: <TValues = any>(values: TValues) => InsertValuesQueryBuilder;
};

type InsertValuesQueryBuilder = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onConflictDoUpdate?: <TConfig = any>(config: TConfig) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDuplicateKeyUpdate?: <TConfig = any>(config: TConfig) => Promise<void>;
};

type DeleteQueryBuilder = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  where: <TCondition = any>(condition: TCondition) => Promise<void>;
};

/**
 * Configuration options for DatabaseTaskStore.
 */
export interface DatabaseTaskStoreOptions<
  T extends SqliteTasksTable | PgTasksTable | MysqlTasksTable,
> {
  /**
   * The Drizzle database instance to use for storage.
   */
  db: DrizzleDatabase;

  /**
   * The tasks table schema to use.
   * Use sqliteTasks, pgTasks, or mysqlTasks from the schema module.
   */
  table: T;

  /**
   * The database dialect. Used to determine the correct upsert strategy.
   * Required to ensure correct SQL generation for your database.
   *
   * @example 'sqlite' for SQLite databases
   * @example 'postgresql' for PostgreSQL databases
   * @example 'mysql' for MySQL/MariaDB databases
   */
  dialect: T extends SqliteTasksTable
    ? 'sqlite'
    : T extends PgTasksTable
      ? 'postgresql'
      : T extends MysqlTasksTable
        ? 'mysql'
        : 'sqlite' | 'postgresql' | 'mysql';
}

type TaskRow =
  | InferSelectModel<SqliteTasksTable>
  | InferSelectModel<PgTasksTable>
  | InferSelectModel<MysqlTasksTable>;

/**
 * A persistent task store implementation using Drizzle ORM.
 *
 * Supports PostgreSQL, MySQL, and SQLite databases through Drizzle ORM.
 * Tasks are stored in a single table with JSON columns for complex nested data.
 */
export class DatabaseTaskStore<T extends SqliteTasksTable | PgTasksTable | MysqlTasksTable>
  implements TaskStore
{
  private db: DrizzleDatabase;
  private table: T;
  private dialect: 'sqlite' | 'postgresql' | 'mysql';

  constructor(options: DatabaseTaskStoreOptions<T>) {
    this.db = options.db;
    this.table = options.table;
    this.dialect = options.dialect;
  }

  /**
   * Saves a task to the database.
   * If a task with the same ID exists, it will be updated.
   * The updatedAt timestamp is automatically set by the database schema.
   *
   * @param task The task to save.
   */
  async save(task: Task): Promise<void> {
    const row = this.taskToRow(task);
    const insertQuery = this.db.insert(this.table).values(row);

    const updateFields = {
      contextId: row.contextId,
      kind: row.kind,
      status: row.status,
      artifacts: row.artifacts,
      history: row.history,
      metadata: row.metadata,
    };

    if (this.dialect === 'mysql') {
      // MySQL uses ON DUPLICATE KEY UPDATE
      if (!insertQuery.onDuplicateKeyUpdate) {
        throw new Error('Database does not support onDuplicateKeyUpdate');
      }
      await insertQuery.onDuplicateKeyUpdate({ set: updateFields });
    } else {
      // SQLite and PostgreSQL use ON CONFLICT DO UPDATE
      if (!insertQuery.onConflictDoUpdate) {
        throw new Error('Database does not support onConflictDoUpdate');
      }
      await insertQuery.onConflictDoUpdate({
        target: this.table.id,
        set: updateFields,
      });
    }
  }

  /**
   * Loads a task from the database by ID.
   *
   * @param taskId The ID of the task to load.
   * @returns The task if found, or undefined if not found.
   */
  async load(taskId: string): Promise<Task | undefined> {
    const results = (await this.db
      .select()
      .from(this.table)
      .where(eq(this.table.id, taskId))) as TaskRow[];

    if (results.length === 0) {
      return undefined;
    }

    return this.rowToTask(results[0]);
  }

  /**
   * Deletes a task from the database by ID.
   *
   * @param taskId The ID of the task to delete.
   */
  async delete(taskId: string): Promise<void> {
    await this.db.delete(this.table).where(eq(this.table.id, taskId));
  }

  /**
   * Converts a Task object to a database row.
   */
  private taskToRow(task: Task) {
    return {
      id: task.id,
      contextId: task.contextId,
      kind: task.kind,
      status: task.status,
      artifacts: task.artifacts ?? null,
      history: task.history ?? null,
      metadata: task.metadata ?? null,
    };
  }

  /**
   * Converts a database row to a Task object.
   */
  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      contextId: row.contextId,
      kind: row.kind as 'task',
      status: row.status,
      ...(row.artifacts && { artifacts: row.artifacts }),
      ...(row.history && { history: row.history }),
      ...(row.metadata && { metadata: row.metadata }),
    };
  }
}

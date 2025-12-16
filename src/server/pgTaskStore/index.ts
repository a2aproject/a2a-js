import { Task, TaskStatus } from '../../types.js';
import { TaskStore } from '../store.js';
import { A2A_DB_NAMES, getMigrations } from './migrations/index.js';
import { Pool } from 'pg';

/**
 * A persistent TaskStore implementation using PostgreSQL.
 *
 * Assumes the following table schema:
 * CREATE TABLE a2a_tasks (
 *   id VARCHAR(255) PRIMARY KEY,
 *   task_data JSONB NOT NULL,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 */
export class PostgresTaskStore implements TaskStore {
  private pool: Pool;
  private isSetup: boolean = false;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async setup(): Promise<void> {
    if (this.isSetup) {
      return;
    }
    const client = await this.pool.connect();
    try {
      // Ensure the public schema exists (it usually does by default)
      await client.query(`CREATE SCHEMA IF NOT EXISTS a2a_public;`);
      let version = -1;
      const MIGRATIONS = getMigrations();

      try {
        const result = await client.query(
          `SELECT v FROM ${A2A_DB_NAMES.MIGRATION} ORDER BY v DESC LIMIT 1`
        );
        if (result.rows.length > 0) {
          version = result.rows[0].v;
        }
      } catch (error) {
        // Assume table doesn't exist if there's an error
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'string' &&
          error.code === '42P01' // Postgres error code for undefined_table
        ) {
          version = -1;
        } else {
          throw error;
        }
      }

      for (let v = version + 1; v < MIGRATIONS.length; v += 1) {
        await client.query(MIGRATIONS[v]);
        await client.query(`INSERT INTO ${A2A_DB_NAMES.MIGRATION} (v) VALUES ($1)`, [v]);
      }

      this.isSetup = true;
    } finally {
      client.release();
    }
  }

  public async load(id: string): Promise<Task | undefined> {
    if (!this.isSetup) {
      throw new Error('PostgresTaskStore not set up. Call .setup() first.');
    }
    const res = await this.pool.query(`SELECT * FROM ${A2A_DB_NAMES.TASKS} WHERE id = $1`, [id]);
    if (res.rows.length === 0) {
      return undefined;
    }
    const row = res.rows[0];
    const reconstructedTask: Task = {
      id: row.id,
      ...row.task_data, // Spread the rest of the task_data
    };

    return reconstructedTask;
  }

  public async save(task: Task): Promise<void> {
    if (!this.isSetup) {
      throw new Error('PostgresTaskStore not set up. Call .setup() first.');
    }

    const taskId = task.id;

    if (!taskId) {
      throw new Error('Task object must contain task id properties for persistence.');
    }

    await this.pool.query(
      `INSERT INTO ${A2A_DB_NAMES.TASKS} (id, task_data)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET
         task_data = $2,
         updated_at = NOW()`,
      [taskId, task]
    );
  }

  public async delete(id: string): Promise<void> {
    if (!this.isSetup) {
      throw new Error('PostgresTaskStore not set up. Call .setup() first.');
    }
    await this.pool.query(`DELETE FROM ${A2A_DB_NAMES.TASKS} WHERE id = $1`, [id]);
  }

  public async list(
    page: string = '1',
    pageSize: string = '10',
    status?: TaskStatus['state'][],
    metadataSearch?: Record<string, unknown>
  ): Promise<{
    result: Task[];
    page: string;
    pageSize: string;
    totalNumberOfTasks: number;
  }> {
    if (!this.isSetup) {
      throw new Error('PostgresTaskStore not set up. Call .setup() first.');
    }

    // let jsonbQuery = `task_data ->'metadata' @> jsonb_build_object(
    //   'memberId', $1::text,
    //   'userId', $2::text
    // )`;
    let jsonbQuery = '';
    if (metadataSearch) {
      jsonbQuery = `task_data ->'metadata' @> jsonb_build_object(${Object.entries(metadataSearch)
        .map(([key, _value], index) => `'${key}', $${index + 1}::text`)
        .join(',')})`;
    }

    let additionalQuery = '';
    if (status) {
      additionalQuery = `AND (task_data ->'status' ->> 'state') IN (${status?.map((status) => `'${status}'`).join(',')})`;
    }

    const params = [...Object.values(metadataSearch)];

    const query = `WITH filtered_tasks AS (
        SELECT *
        FROM ${A2A_DB_NAMES.TASKS} WHERE ${jsonbQuery} ${additionalQuery}
      ),
      paginated_tasks AS (
        SELECT *
        FROM filtered_tasks
        ORDER BY created_at DESC
        LIMIT ${parseInt(pageSize)} OFFSET ${(parseInt(page) - 1) * parseInt(pageSize)}
      ),
      total_filtered_count AS (
        SELECT COUNT(*) AS count FROM filtered_tasks
      )
      SELECT
        (
          SELECT json_agg(pt ORDER BY pt.created_at DESC)
          FROM paginated_tasks pt
        ) AS tasks,
        total_filtered_count.count
      FROM total_filtered_count;`;

    const res = await this.pool.query(query, params);

    return {
      result: res.rows[0].tasks
        ? res.rows[0].tasks.map((row: { id: string; task_data: Task }) => {
            const reconstructedTask: Task = {
              id: row.id,
              ...row.task_data,
            };
            return reconstructedTask;
          })
        : [],
      page,
      pageSize,
      totalNumberOfTasks: res.rows[0].count,
    };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

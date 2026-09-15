/**
 * Name of the task table. For now, fixed, not configurable.
 */
export const TASK_TABLE = 'tasks';

/**
 * Row shape of the task table.
 */
export interface TaskRow {
  tenant: string;
  owner: string;
  id: string;
  context_id: string;
  /** `bigint`, which PostgreSQL's driver reads back as a string. */
  status_last_updated: number | string;
  status_state: string | null;
  status: string | null;
  artifacts: string | null;
  history: string | null;
  metadata: string | null;
  protocol_version: string | null;
}

/**
 * The schema this store owns.
 * Kysely resolves column names against this at compile time.
 */
export type TaskDatabase = Record<typeof TASK_TABLE, TaskRow>;

/**
 * The primary key: the caller's scope plus the task's own identity.
 */
export const TASK_TABLE_KEY_COLUMNS = [
  'tenant',
  'owner',
  'id',
] as const satisfies readonly (keyof TaskRow)[];

export const TASK_TABLE_COLUMNS = [
  ...TASK_TABLE_KEY_COLUMNS,
  'context_id',
  'status_last_updated',
  'status_state',
  'status',
  'artifacts',
  'history',
  'metadata',
  'protocol_version',
] as const satisfies readonly (keyof TaskRow)[];

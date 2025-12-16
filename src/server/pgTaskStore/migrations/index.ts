export enum A2A_DB_NAMES {
  MIGRATION = 'a2a_public.a2a_migrations',
  TASKS = 'a2a_public.a2a_tasks',
  METADATA_INDEX = 'idx_metadata_gin',
  STATUS_INDEX = 'idx_status_gin',
}

export const getMigrations = () => [
  `
    CREATE TABLE IF NOT EXISTS ${A2A_DB_NAMES.MIGRATION} (
      v INT PRIMARY KEY
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS ${A2A_DB_NAMES.TASKS} (
      id VARCHAR(255) PRIMARY KEY,
      task_data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,

  `CREATE INDEX IF NOT EXISTS ${A2A_DB_NAMES.METADATA_INDEX}
      ON ${A2A_DB_NAMES.TASKS}
      USING gin ((task_data->'metadata'));`,

  `CREATE INDEX IF NOT EXISTS ${A2A_DB_NAMES.STATUS_INDEX}
      ON ${A2A_DB_NAMES.TASKS}
      USING gin ((task_data->'status'));`,
];

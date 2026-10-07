import { describeStoreMigrations } from '../support/database/store_migrations_behavior.js';

// Spelled out rather than imported from the store: a test that reads these from the code
// it checks cannot catch a rename, and a renamed ledger makes a migrated database look
// untouched.
const KEY_COLUMNS = ['tenant', 'owner', 'id'];

describeStoreMigrations({
  title: 'task',
  id: 'tasks',
  table: 'tasks',
  ledgerTable: 'a2a_tasks_migrations',
  migration: '0001_create_tasks',
  tableNameFlag: '--tasks-table-name',
  keyColumns: KEY_COLUMNS,
  allColumns: [
    ...KEY_COLUMNS,
    'context_id',
    'status_last_updated',
    'status_state',
    'status',
    'artifacts',
    'history',
    'metadata',
    'protocol_version',
  ],
  notNullColumns: [...KEY_COLUMNS, 'context_id', 'status_last_updated'],
  nullableColumns: [
    'status_state',
    'status',
    'artifacts',
    'history',
    'metadata',
    'protocol_version',
  ],
  widths: { tenant: 255, owner: 255, id: 36, context_id: 36, status_state: 255 },
  collatedColumns: [...KEY_COLUMNS, 'context_id', 'status_state'],
  // The listing indexes, and the column order the keyset pagination depends on.
  indexes: {
    tasks_scope_updated_idx: ['tenant', 'owner', 'status_last_updated', 'id'],
    tasks_scope_context_updated_idx: ['tenant', 'owner', 'context_id', 'status_last_updated', 'id'],
  },
  renamedTable: 'agent_tasks',
  renamedLedgerTable: 'a2a_agent_tasks_migrations',
  secondTable: 'other_tasks',
  secondLedgerTable: 'a2a_other_tasks_migrations',
  otherStoreTables: ['push_notification_configs', 'a2a_push_notification_configs_migrations'],
  sqlitePrefix: 'a2a-task-migrations-',
});

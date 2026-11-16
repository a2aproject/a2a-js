import { describeStoreMigrations } from '../support/database/store_migrations_behavior.js';

// Spelled out rather than imported from the store: a test that reads these from the code
// it checks cannot catch a rename, and a renamed ledger makes a migrated database look
// untouched.
const KEY_COLUMNS = ['tenant', 'owner', 'task_id', 'config_id'];

describeStoreMigrations({
  title: 'push notification',
  id: 'push-notification-configs',
  table: 'push_notification_configs',
  ledgerTable: 'a2a_push_notification_configs_migrations',
  migration: '0001_create_push_notification_configs',
  tableNameFlag: '--push-notification-configs-table-name',
  keyColumns: KEY_COLUMNS,
  allColumns: [...KEY_COLUMNS, 'config_data', 'protocol_version'],
  notNullColumns: KEY_COLUMNS,
  nullableColumns: ['config_data', 'protocol_version'],
  widths: { task_id: 36, config_id: 36, tenant: 255, owner: 255 },
  collatedColumns: KEY_COLUMNS,
  // This table has no secondary indexes, so the index test expects none.
  indexes: {},
  renamedTable: 'agent_push_configs',
  renamedLedgerTable: 'a2a_agent_push_configs_migrations',
  secondTable: 'other_push_configs',
  secondLedgerTable: 'a2a_other_push_configs_migrations',
  otherStoreTables: ['tasks', 'a2a_tasks_migrations'],
  sqlitePrefix: 'a2a-push-notification-migrations-',
});

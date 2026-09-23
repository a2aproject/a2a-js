# Persistent Stores and Migrations

The in-memory stores, `InMemoryTaskStore` (which you pass to `DefaultRequestHandler`) and `InMemoryPushNotificationStore` (which it falls back to when push notifications are enabled and no store is passed), keep state in process memory. All tasks, message history, status transitions, artifacts, and push notification configurations are lost whenever the server process restarts.

For persistent production deployments, `@a2a-js/sdk/server/database` provides database-backed implementations powered by [Kysely](https://kysely.dev/):

- **`DatabaseTaskStore`** — stores task snapshots, status updates, message histories, and artifacts.
- **`DatabasePushNotificationStore`** — stores client-registered webhook URLs and notification tokens.

Both stores work with:

- **PostgreSQL**: tested on 17
- **MySQL**: tested on 8.0
- **SQLite**: the version bundled with `better-sqlite3` — tested on 12 and 13
- **Cloudflare D1**: through the community `kysely-d1` dialect — tested on 0.4, against Miniflare's local D1

MySQL is the only engine with a known minimum: the migrations use the `utf8mb4_0900_bin` collation, which only exists from MySQL 8.0, so `a2a-db upgrade` fails on older versions.

---

## Installation & Prerequisites

`kysely` and the drivers (`pg`, `mysql2`, `better-sqlite3`) are optional peer dependencies of `@a2a-js/sdk`. Install `kysely` along with the driver for your database:

```bash
# PostgreSQL
npm install kysely pg

# MySQL
npm install kysely mysql2

# SQLite
npm install kysely better-sqlite3
```

### Node.js Compatibility

On Node.js 20, install `kysely@^0.28.17` and `better-sqlite3@^12.0.0` for SQLite. The latest versions of both require Node.js 22 or later.

### Cloudflare D1

For Cloudflare D1, use the community `kysely-d1` dialect instead, which is not a peer dependency of the SDK:

```bash
npm install kysely kysely-d1
```

---

## Server Setup

Both stores share a single Kysely database connection instance. The tables must already exist before the server boots — migrations are an operator deployment step, not executed on server startup.

```typescript
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
// MySQL:  import { MysqlDialect } from 'kysely'; import { createPool } from 'mysql2';
// SQLite: import { SqliteDialect } from 'kysely'; import SQLite from 'better-sqlite3';

import { DatabaseTaskStore, DatabasePushNotificationStore } from '@a2a-js/sdk/server/database';
import { DefaultPushNotificationSender } from '@a2a-js/sdk/server';

// 1. Create one Kysely connection for both stores. The stores accept a connection typed
// with any schema, so this can also be the one your application already uses.
const db = new Kysely({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  }),
  // MySQL:  dialect: new MysqlDialect({ pool: createPool({ uri: process.env.DATABASE_URL }) }),
  // SQLite: dialect: new SqliteDialect({ database: new SQLite('a2a.db') }),
});

// 2. Initialize persistent stores
const taskStore = new DatabaseTaskStore(db);
const pushNotificationStore = new DatabasePushNotificationStore(db);
const pushNotificationSender = new DefaultPushNotificationSender(pushNotificationStore);
```

### Cloudflare D1

On Cloudflare Workers, build the stores on the D1 binding with the `kysely-d1` dialect:

```typescript
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { DatabaseTaskStore, DatabasePushNotificationStore } from '@a2a-js/sdk/server/database';

export default {
  // `env.DB` is the D1 database from the `d1_databases` entry in your wrangler config.
  async fetch(request: Request, env: { DB: D1Database }) {
    const db = new Kysely({ dialect: new D1Dialect({ database: env.DB }) });
    const taskStore = new DatabaseTaskStore(db);
    const pushNotificationStore = new DatabasePushNotificationStore(db);
  },
};
```

---

## Database Migrations

The SDK ships an `a2a-db` CLI that creates and updates the store tables. Once `@a2a-js/sdk` is installed, run it with `npx a2a-db`; `npx a2a-db --help` prints the full usage.

### Commands

- `status`: Show the migration status of each store.
- `upgrade`: Apply pending migrations, always up to the latest migration. Safe to re-run.
- `downgrade [<to>]`: Revert migrations, by default the latest one of each store. Pass `<to>` as a migration name to stop at (leaving it applied), or `base` to revert all.

### Options

- `--url <url>`: Database URL: `postgresql://...`, `postgres://...`, `mysql://...` or `sqlite:./path/to/file.db`. Defaults to the `DATABASE_URL` environment variable.
- `--store <id>`: Target a specific store, `tasks` or `push-notification-configs` (repeatable). Default: all stores. Required when naming a migration.
- `--<store-id>-table-name <name>`: Override a store's table name. See [Table Renaming](#table-renaming).

### Offline SQL Generation

With `--sql`, `a2a-db` prints the SQL instead of running it, so you can review it before applying it, or apply it to a database the CLI cannot connect to. It opens no connection, loads no driver, and ignores `--url`.

- `--sql`: Print SQL statements instead of connecting to a database.
- `--dialect <name>`: SQL dialect to render: `postgres`, `mysql` or `sqlite`. Required with `--sql`.
- `--from <revision>`: Where the database is now: `base`, `latest` or a migration name. Defaults to `base` for `upgrade` and `latest` for `downgrade`.

The script writes the migration ledger alongside the tables, so once it is applied, `a2a-db status` and later online commands see the database as if the migration had run online. Two main differences remain: the lock table isn't created, and the ledger timestamps record when the script was rendered rather than applied.

#### Cloudflare D1

For D1, use `--sql` with the `sqlite` dialect, then apply the script with `wrangler d1 execute`. See [Examples](#examples).

### Table Renaming

By default the stores use the tables `tasks` and `push_notification_configs`. To run several agent deployments in one database, or to avoid clashing with your own tables, rename them: pass the same name to `a2a-db` with `--<store-id>-table-name`, where `<store-id>` is `tasks` or `push-notification-configs`, and to the store with the `tableName` option, for example `new DatabaseTaskStore(db, { tableName: 'custom_tasks' })`.

Each store's migration ledger follows its table name, as `a2a_<tableName>_migrations` (for example `a2a_custom_tasks_migrations`), so deployments with different table names never share a ledger. Table names are limited to 37 characters: migrations derive index and constraint names from the table name (the longest adds `_scope_context_updated_idx`), and PostgreSQL truncates identifiers longer than 63 characters, so `a2a-db` rejects longer names instead.

### Lock Table

Online `upgrade` and `downgrade` also create `a2a_migrations_lock`, the table Kysely's migrator keeps for its migration lock. Every store and every deployment in the database shares it, whatever its table names. Scripts rendered with `--sql` don't create it.

### Cleaning Up

`downgrade base` reverts every migration and drops the store tables; pass the same `--<store-id>-table-name` flags if you renamed them. It leaves the bookkeeping, though: it only deletes the ledgers' rows and never drops the lock table. To remove everything, drop them manually once no deployment in the database uses `a2a-db` anymore:

```sql
DROP TABLE a2a_migrations_lock;
-- Default names. If you renamed the tables, use a2a_<tableName>_migrations instead,
DROP TABLE a2a_tasks_migrations;
DROP TABLE a2a_push_notification_configs_migrations;
```

### Examples

```bash
# Apply pending migrations
npx a2a-db upgrade --url postgresql://user:pass@localhost:5432/my_db

# Check migration status
npx a2a-db status --url postgresql://user:pass@localhost:5432/my_db

# Revert the latest migration of each store
npx a2a-db downgrade --url postgresql://user:pass@localhost:5432/my_db

# Revert every migration
npx a2a-db downgrade base --url postgresql://user:pass@localhost:5432/my_db

# Revert the task store down to a named migration, which stays applied. A migration name
# belongs to one store, so name it; with one migration per store, this changes nothing yet.
npx a2a-db downgrade 0001_create_tasks --store tasks --url postgresql://user:pass@localhost:5432/my_db

# Migrate only the task store, taking the URL from the environment
DATABASE_URL=postgresql://user:pass@localhost:5432/my_db npx a2a-db upgrade --store tasks

# Custom table names
npx a2a-db upgrade \
  --tasks-table-name custom_tasks \
  --push-notification-configs-table-name custom_push_notification_configs \
  --url postgresql://user:pass@localhost:5432/my_db

# SQL for an empty database
npx a2a-db upgrade --sql --dialect postgres > schema.sql

# SQL to revert the latest migration of each store
npx a2a-db downgrade --sql --dialect mysql > rollback.sql

# SQL to revert every migration
npx a2a-db downgrade base --sql --dialect sqlite > rollback.sql

# SQL from a known migration forward. A migration name belongs to one store, so name the
# store too; each store has a single migration today, so this renders nothing yet.
npx a2a-db upgrade --sql --dialect sqlite --store tasks --from 0001_create_tasks

# Cloudflare D1: render the schema, then apply it with Wrangler
npx a2a-db upgrade --sql --dialect sqlite > schema.sql
wrangler d1 execute <database-name> --remote --file schema.sql
```

---

## Runnable Sample

A complete, runnable example demonstrating `DatabaseTaskStore`, `DatabasePushNotificationStore`, migrations, and persistence verification across server restarts is available in [`src/samples/agents/database-agent/`](../src/samples/agents/database-agent/).

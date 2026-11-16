# Database-Backed Agent

This sample demonstrates how to run an A2A agent with **persistent database storage** using:
- [`DatabaseTaskStore`](../../../server/database/task/store.ts) — persists task snapshots, status updates, messages, and artifacts.
- [`DatabasePushNotificationStore`](../../../server/database/push_notification/store.ts) — persists webhook configurations registered by clients.

Both stores connect through a single [`Kysely`](https://kysely.dev/) instance to a local SQLite database (`a2a.db`).

## Components

- `agent_executor.ts` — handles execution turns, publishing initial task state, status updates, and output artifacts.
- `index.ts` — Express A2A server initialized with `DatabaseTaskStore` and `DatabasePushNotificationStore` backed by SQLite.
- `webhook.ts` — standalone webhook endpoint receiving push notifications forwarded by the agent using configs stored in SQLite.
- `client.ts` — client script that submits tasks, registers push notification configs, and fetches tasks & push configs by ID to verify persistence across server restarts.

## Running the Sample

### Step 1: Run Migrations

Database-backed stores require the schema to be initialized before the server starts. Navigate to `src/samples` and initialize the SQLite database:

```bash
cd src/samples

# Option A: Online migration via a2a-db CLI
npm run a2a-db -- upgrade --url sqlite:./a2a.db
```

> *Note: In a standalone project where `@a2a-js/sdk` is installed, run `npx a2a-db` directly.*

Alternatively, you can generate and execute the SQL script offline:

```bash
cd src/samples

# Option B: Render SQL offline and execute it
npm run a2a-db -- upgrade --sql --dialect sqlite > schema.sql
sqlite3 a2a.db < schema.sql
```

You can verify the migration status with:

```bash
npm run a2a-db -- status --url sqlite:./a2a.db
```

### Step 2: Start the Agent and Webhook Receiver

Open two terminals inside `src/samples`:

**Terminal 1 — start the agent server:**

```bash
npm run agents:database-agent
```

The server will start on `http://localhost:41241` and connect to `a2a.db`.

**Terminal 2 — start the webhook receiver:**

```bash
cd src/samples
npm run agents:database-webhook
```

The webhook listener will start on `http://localhost:42424/webhook/task-updates`.

### Step 3: Run the Client to Create a Task

In a third terminal:

```bash
cd src/samples
npm run agents:database-client
```

The client will:
1. Submit a new task with a push notification webhook configuration pointing to `http://localhost:42424/webhook/task-updates`.
2. The agent server stores the push config in SQLite (`DatabasePushNotificationStore`), runs the task, and sends event updates to the webhook.
3. Terminal 2 will log incoming event notifications in real time.
4. Terminal 3 receives the completed task and displays the created task ID (e.g. `task-abc-123`).

### Step 4: Verify Persistence Across Server Restarts

1. In Terminal 1, stop the agent server.
2. Restart the server:
   ```bash
   npm run agents:database-agent
   ```
3. In Terminal 3 (client), fetch the task created earlier using its ID:
   ```bash
   npm run agents:database-client -- <taskId>
   ```
   The client will retrieve:
   - The task, history, status, and generated artifact content from `DatabaseTaskStore`.
   - The registered webhook configuration from `DatabasePushNotificationStore`.

   Example output:
   ```
   [Client] Task found in persistent storage!
   [Client]   ID:         c922765e-...
   [Client]   State:      TASK_STATE_COMPLETED
   [Client]   Messages:   2
   [Client]   Artifacts:  1
   [Client]   Artifact 1: "Agent Execution Result"
   [Client]     Content:  Agent Analysis Complete:
   [Client]               Successfully processed request: "Hello from persistent client!".
   [Client]               Execution result, history, and status have been persisted to SQLite via DatabaseTaskStore.
   [Client] Push Notification Configs: 1
   [Client]   Target URL: http://localhost:42424/webhook/task-updates

   [Client] Success! Both task and push configs were restored from SQLite.
   ```

Both stores successfully persist and restore state from SQLite across server restarts!

You can also inspect the SQLite tables directly:

```bash
sqlite3 a2a.db "SELECT id, status_state FROM tasks;"
sqlite3 a2a.db "SELECT task_id, config_data FROM push_notification_configs;"
sqlite3 a2a.db "SELECT name, timestamp FROM a2a_tasks_migrations;"
```

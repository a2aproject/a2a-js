import Database from 'better-sqlite3';
import express from 'express';
import { Kysely, SqliteDialect } from 'kysely';
import path from 'node:path';

import { A2A_PROTOCOL_VERSION, AgentCard, AGENT_CARD_PATH } from '../../../index.js';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '../../../server/express/index.js';
import {
  DatabaseTaskStore,
  DatabasePushNotificationStore,
} from '../../../server/database/index.js';
import { DefaultPushNotificationSender, DefaultRequestHandler } from '../../../server/index.js';
import { DatabaseAgentExecutor } from './agent_executor.js';

const PORT = Number(process.env.PORT || 41241);
const DATABASE_FILE = process.env.DATABASE_FILE || path.resolve(process.cwd(), 'a2a.db');

export const databaseAgentCard: AgentCard = {
  name: 'Database-Backed Agent',
  description:
    'A sample A2A agent demonstrating persistent task and push notification storage ' +
    'backed by SQLite via Kysely (DatabaseTaskStore and DatabasePushNotificationStore).',
  supportedInterfaces: [
    {
      url: `http://localhost:${PORT}/`,
      protocolBinding: 'JSONRPC',
      tenant: '',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
  ],
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples',
  },
  version: '1.0.0',
  capabilities: {
    streaming: true,
    pushNotifications: true,
    extensions: [],
    extendedAgentCard: false,
  },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'],
  skills: [
    {
      id: 'database_agent_demo',
      name: 'Database Agent Demo',
      description: 'Processes a task and persists state in SQLite across server restarts.',
      tags: ['database', 'sqlite', 'persistence', 'task-store', 'push-notifications'],
      examples: ['hello', 'run task', 'test persistence'],
      inputModes: ['text'],
      outputModes: ['text', 'task-status'],
      securityRequirements: [],
    },
  ],
  documentationUrl: '',
  signatures: [],
};

async function main() {
  // 1. Initialize SQLite database & Kysely
  const sqlite = new Database(DATABASE_FILE);
  const dialect = new SqliteDialect({ database: sqlite });
  const db = new Kysely({ dialect });

  // 2. Validate tables exist, with guidance if migrations were not run
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks', 'push_notification_configs')"
    )
    .all([]) as { name: string }[];
  if (tables.length < 2) {
    console.warn(
      `\n[DatabaseAgent] WARNING: One or more database tables are missing in "${DATABASE_FILE}".\n` +
        `[DatabaseAgent] Run migrations before using the agent:\n` +
        `[DatabaseAgent]   npm run a2a-db -- upgrade --url sqlite:${DATABASE_FILE}\n`
    );
  }

  // 3. Create persistent stores backed by the database.
  const taskStore = new DatabaseTaskStore(db);
  const pushNotificationStore = new DatabasePushNotificationStore(db);
  const pushNotificationSender = new DefaultPushNotificationSender(pushNotificationStore);

  // 4. Create AgentExecutor
  const agentExecutor = new DatabaseAgentExecutor();

  // 5. Create DefaultRequestHandler with persistent stores
  const requestHandler = new DefaultRequestHandler(
    databaseAgentCard,
    taskStore,
    agentExecutor,
    undefined, // eventBusManager (use default)
    pushNotificationStore,
    pushNotificationSender
  );

  // 6. Setup Express app
  const app = express();
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  // 7. Start the server
  const server = app.listen(PORT, () => {
    console.log(`[DatabaseAgent] Server listening on http://localhost:${PORT}`);
    console.log(`[DatabaseAgent] Agent Card: http://localhost:${PORT}/${AGENT_CARD_PATH}`);
    console.log(`[DatabaseAgent] Database file: ${DATABASE_FILE}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[DatabaseAgent] Port ${PORT} is already in use. ` +
          `Set PORT to a free port, or stop the process using it.`
      );
    } else {
      console.error('[DatabaseAgent] Server error:', err);
    }
    process.exit(1);
  });

  // Shutdown
  const shutdown = () => {
    console.log('\n[DatabaseAgent] Shutting down...');
    server.close(async () => {
      await db.destroy();
      sqlite.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[DatabaseAgent] Startup error:', err);
  process.exit(1);
});

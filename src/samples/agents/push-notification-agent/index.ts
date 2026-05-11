import express from 'express';

import { A2A_PROTOCOL_VERSION, AGENT_CARD_PATH, AgentCard } from '../../../index.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  DefaultRequestHandler,
  InMemoryPushNotificationStore,
  DefaultPushNotificationSender,
} from '../../../server/index.js';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '../../../server/express/index.js';
import { PushNotificationAgentExecutor } from './agent_executor.js';

// --- Server Setup ---

const PORT = Number(process.env.PORT || 41241);

const pushNotificationAgentCard: AgentCard = {
  name: 'Sample Push Notification Agent',
  description:
    'A long-running sample agent that demonstrates A2A push notifications: task ' +
    'updates are POSTed to a client-provided webhook as the task progresses.',
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
    pushNotifications: true, // Required to opt into push notification support.
    extensions: [],
    extendedAgentCard: false,
  },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'],
  skills: [
    {
      id: 'push_notification_demo',
      name: 'Push Notification Demo',
      description:
        'Runs a multi-step long-running task that publishes status updates to ' +
        'the configured push notification webhook.',
      tags: ['push-notification', 'webhook', 'long-running'],
      examples: ['start a long task', 'notify me when done'],
      inputModes: ['text'],
      outputModes: ['text', 'task-status'],
      securityRequirements: [],
    },
  ],
  documentationUrl: '',
  signatures: [],
};

async function main() {
  // 1. Create TaskStore.
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor.
  const agentExecutor: AgentExecutor = new PushNotificationAgentExecutor();

  // 3. Configure push notification components.
  //    The InMemoryPushNotificationStore stores per-task webhook configs sent
  //    by clients. The DefaultPushNotificationSender POSTs every published
  //    AgentExecutionEvent (Task, Message, TaskStatusUpdateEvent, or
  //    TaskArtifactUpdateEvent) to the configured URL, optionally setting an
  //    `X-A2A-Notification-Token` header from `pushConfig.token`.
  const pushNotificationStore = new InMemoryPushNotificationStore();
  const pushNotificationSender = new DefaultPushNotificationSender(pushNotificationStore, {
    timeout: 5000,
    tokenHeaderName: 'X-A2A-Notification-Token',
  });

  // 4. Create DefaultRequestHandler with custom push notification components.
  const requestHandler = new DefaultRequestHandler(
    pushNotificationAgentCard,
    taskStore,
    agentExecutor,
    undefined, // eventBusManager (use default)
    pushNotificationStore,
    pushNotificationSender
  );

  // 5. Create and setup Express app.
  const app = express();
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  // 6. Start the server.
  const server = app.listen(PORT);
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[PushNotificationAgent] Port ${PORT} is already in use. ` +
          `Set PORT to a free port, or stop the process using it.`
      );
    } else {
      console.error('[PushNotificationAgent] Server error:', err);
    }
    process.exit(1);
  });
  server.on('listening', () => {
    console.log(`[PushNotificationAgent] Server started on http://localhost:${PORT}`);
    console.log(
      `[PushNotificationAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`
    );
    console.log('[PushNotificationAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);

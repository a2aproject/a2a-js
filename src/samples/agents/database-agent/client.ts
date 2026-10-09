import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from '../../../client/index.js';
import { Role, taskStateToJSON, type Artifact } from '../../../index.js';
import { SendMessageRequest } from '../../../types/pb/a2a.js';

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:41241';
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || 42424);
const WEBHOOK_URL =
  process.env.WEBHOOK_URL || `http://localhost:${WEBHOOK_PORT}/webhook/task-updates`;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || 'sample-secret-token';

function printArtifacts(artifacts: Artifact[]) {
  for (const [idx, artifact] of artifacts.entries()) {
    console.log(`[Client]   Artifact ${idx + 1}: "${artifact.name}"`);
    for (const part of artifact.parts) {
      if (part.content?.$case === 'text') {
        const lines = part.content.value.split('\n');
        console.log(`[Client]     Content:  ${lines[0]}`);
        for (const line of lines.slice(1)) {
          console.log(`[Client]               ${line}`);
        }
      }
    }
  }
}

async function main() {
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new JsonRpcTransportFactory()],
    })
  );
  const client = await factory.createFromUrl(AGENT_URL);

  const existingTaskId = process.argv[2];

  // If a task ID was passed, query and verify that task persists across restarts.
  if (existingTaskId) {
    console.log(`[Client] Fetching existing task "${existingTaskId}" from ${AGENT_URL}...`);
    try {
      const task = await client.getTask({ id: existingTaskId, tenant: '' });
      const stateStr = task.status ? taskStateToJSON(task.status.state) : '(unknown)';
      console.log(`[Client] Task found in persistent storage!`);
      console.log(`[Client]   ID:         ${task.id}`);
      console.log(`[Client]   State:      ${stateStr}`);
      console.log(`[Client]   Messages:   ${task.history.length}`);
      console.log(`[Client]   Artifacts:  ${task.artifacts.length}`);
      printArtifacts(task.artifacts);

      // Also query the push notification configs from DatabasePushNotificationStore
      const pushResponse = await client.listTaskPushNotificationConfig({
        taskId: existingTaskId,
        tenant: '',
        pageSize: 10,
        pageToken: '',
      });
      console.log(`[Client] Push Notification Configs: ${pushResponse.configs.length}`);
      for (const config of pushResponse.configs) {
        console.log(`[Client]   Config ID:  ${config.id}`);
        console.log(`[Client]   Target URL: ${config.url}`);
      }

      console.log('\n[Client] Success! Both task and push configs were restored from SQLite.');
    } catch (error) {
      console.error(`[Client] Failed to retrieve task "${existingTaskId}":`, error);
      process.exit(1);
    }
    return;
  }

  // Otherwise, create a new task with a push notification configuration.
  console.log(`[Client] Submitting new task to ${AGENT_URL}...`);
  const params: SendMessageRequest = {
    tenant: '',
    metadata: {},
    message: {
      messageId: crypto.randomUUID(),
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: 'text', value: 'Hello from persistent client!' },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        },
      ],
      taskId: '',
      contextId: '',
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ['text/plain'],
      returnImmediately: false,
      // Register a push notification config to demonstrate DatabasePushNotificationStore
      taskPushNotificationConfig: {
        id: '',
        taskId: '',
        tenant: '',
        url: WEBHOOK_URL,
        token: WEBHOOK_TOKEN,
        authentication: undefined,
      },
    },
  };

  const result = await client.sendMessage(params);

  if ('id' in result) {
    const stateStr = result.status ? taskStateToJSON(result.status.state) : '(unknown)';
    console.log(`[Client] Task created and completed:`);
    console.log(`[Client]   ID:         ${result.id}`);
    console.log(`[Client]   State:      ${stateStr}`);
    console.log(`[Client]   Messages:   ${result.history.length}`);
    console.log(`[Client]   Artifacts:  ${result.artifacts.length}`);
    printArtifacts(result.artifacts);
    console.log(
      `[Client]   Push Config: Registered for ${params.configuration?.taskPushNotificationConfig?.url}`
    );

    // Verify task is immediately retrievable via getTask
    const loaded = await client.getTask({ id: result.id, tenant: '' });
    console.log(`[Client] Verified task in store: id=${loaded.id}`);

    console.log('\n======================================================');
    console.log('             PERSISTENCE VERIFICATION                ');
    console.log('======================================================');
    console.log('Both the task and its push notification config are now');
    console.log('stored in the SQLite database (a2a.db).\n');
    console.log('To verify that data persists across server restarts:');
    console.log('  1. Stop the agent server in its terminal.');
    console.log('  2. Restart the server:');
    console.log('       npm run agents:database-agent');
    console.log('  3. In this terminal, fetch the task again:');
    console.log(`       npm run agents:database-client -- ${result.id}\n`);
    console.log('You can also inspect the SQLite database directly:');
    console.log('  sqlite3 a2a.db "SELECT id, status_state FROM tasks;"');
    console.log('  sqlite3 a2a.db "SELECT task_id, config_data FROM push_notification_configs;"');
    console.log('======================================================\n');
  } else {
    console.log(`[Client] Received direct message:`, result);
  }
}

main().catch((err) => {
  console.error('[Client] Error:', err);
  process.exit(1);
});

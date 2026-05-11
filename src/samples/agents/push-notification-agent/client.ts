import { v4 as uuidv4 } from 'uuid';

import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from '../../../client/index.js';
import { Role, taskStateToJSON } from '../../../index.js';
import { SendMessageRequest } from '../../../types/pb/a2a.js';

/**
 * Sends a single message to the push-notification agent and configures a
 * webhook URL for task updates. The agent will then POST every Task,
 * `TaskStatusUpdateEvent`, and `TaskArtifactUpdateEvent` it publishes to
 * the webhook URL while it processes the task — see A2A Specification
 * §3.5.3 (Push Notification Delivery):
 * https://a2a-protocol.org/latest/specification/#353-push-notification-delivery.
 *
 * `WEBHOOK_URL` defaults to `http://localhost:${WEBHOOK_PORT}/webhook/task-updates`,
 * so setting `WEBHOOK_PORT` consistently in the webhook and client terminals
 * is enough to override the port without each having to set `WEBHOOK_URL`.
 */

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:41241';
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || 42424);
const WEBHOOK_URL =
  process.env.WEBHOOK_URL || `http://localhost:${WEBHOOK_PORT}/webhook/task-updates`;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || 'demo-token';

async function main() {
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new JsonRpcTransportFactory()],
    })
  );
  const client = await factory.createFromUrl(AGENT_URL);

  const params: SendMessageRequest = {
    tenant: '',
    metadata: {},
    message: {
      messageId: uuidv4(),
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: 'text', value: 'Please run a long task and notify me.' },
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
      returnImmediately: true, // Return as soon as the Task is created.
      taskPushNotificationConfig: {
        // `id` and `taskId` will be filled in by the server when the Task is created.
        id: '',
        taskId: '',
        tenant: '',
        url: WEBHOOK_URL,
        token: WEBHOOK_TOKEN,
        authentication: undefined,
      },
    },
  };

  console.log(`[Client] Sending message to ${AGENT_URL}`);
  console.log(`[Client] Push notifications will be POSTed to ${WEBHOOK_URL}`);

  const result = await client.sendMessage(params);

  if ('id' in result) {
    const stateStr = result.status ? taskStateToJSON(result.status.state) : '(unset)';
    console.log(`[Client] Task created: id=${result.id} state=${stateStr}`);
    console.log('[Client] Watch the webhook process for incoming notifications.');
  } else {
    console.log(`[Client] Received direct message: ${JSON.stringify(result, null, 2)}`);
  }
}

main().catch((err) => {
  console.error('[Client] Error:', err);
  process.exit(1);
});

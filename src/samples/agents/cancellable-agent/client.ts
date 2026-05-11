import { v4 as uuidv4 } from 'uuid';

import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from '../../../client/index.js';
import { Role, TaskState, taskStateToJSON } from '../../../index.js';
import { SendMessageRequest } from '../../../types/pb/a2a.js';

/**
 * Demonstrates user-initiated task cancellation.
 *
 * Flow:
 *   1. Open a streaming send-message call.
 *   2. Capture the taskId from the first `task` event.
 *   3. After a short delay, call `client.cancelTask({ id: taskId })`.
 *   4. Continue consuming the stream until the agent publishes the final
 *      `TASK_STATE_CANCELED` status update.
 */

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:41241';
const CANCEL_AFTER_MS = Number(process.env.CANCEL_AFTER_MS || 2500);

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
          content: { $case: 'text', value: 'Please run a long task.' },
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
    configuration: undefined,
  };

  console.log(`[Client] Sending streaming message to ${AGENT_URL}`);
  const stream = client.sendMessageStream(params);

  let taskId: string | undefined;
  let cancelTimer: NodeJS.Timeout | undefined;

  for await (const event of stream) {
    const payload = event.payload;
    if (!payload) {
      continue;
    }

    switch (payload.$case) {
      case 'task': {
        const task = payload.value;
        taskId = task.id;
        console.log(
          `[Client] Task created id=${task.id} state=${taskStateToJSON(task.status!.state)}`
        );

        // Schedule a cancellation request once we know the taskId.
        cancelTimer = setTimeout(async () => {
          console.log(`[Client] Sending cancelTask for ${taskId} after ${CANCEL_AFTER_MS}ms`);
          try {
            const cancelled = await client.cancelTask({
              tenant: '',
              id: taskId!,
              metadata: {},
            });
            console.log(
              `[Client] cancelTask returned state=${taskStateToJSON(cancelled.status!.state)}`
            );
          } catch (err) {
            console.error(`[Client] cancelTask failed:`, err);
          }
        }, CANCEL_AFTER_MS);
        break;
      }
      case 'statusUpdate': {
        const update = payload.value;
        console.log(
          `[Client] statusUpdate task=${update.taskId} state=${taskStateToJSON(update.status!.state)}`
        );
        if (update.status?.state === TaskState.TASK_STATE_CANCELED) {
          console.log(`[Client] Confirmed task ${update.taskId} was cancelled.`);
        }
        break;
      }
      case 'artifactUpdate': {
        const update = payload.value;
        console.log(
          `[Client] artifactUpdate task=${update.taskId} artifact=${update.artifact?.name}`
        );
        break;
      }
      case 'message':
        console.log(`[Client] Received direct message event.`);
        break;
    }
  }

  if (cancelTimer) {
    clearTimeout(cancelTimer);
  }
  console.log('[Client] Stream complete.');
}

main().catch((err) => {
  console.error('[Client] Error:', err);
  process.exit(1);
});

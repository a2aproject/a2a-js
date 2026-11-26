import { parseArgs } from 'node:util';

import { Role, Task, taskStateToJSON } from '../../index.js';
import { ClientFactory, ClientFactoryOptions } from '../../client/index.js';
import { GrpcTransportFactory } from '../../client/transports/grpc/grpc_transport.js';
import { experiments } from './plugins.js';

/**
 * Calls the plugins agent with the `experiments` client plugin installed, so
 * every request carries an experiment ID that the server plugins log.
 *
 * Usage: npm run agents:plugins-client [-- --transport=JSONRPC|HTTP+JSON|GRPC]
 */

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:41241';
const EXPERIMENT_ID = process.env.EXPERIMENT_ID || 'exp-42';

const { values: flags } = parseArgs({ options: { transport: { type: 'string' } } });

const factory = new ClientFactory(
  ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    transports: [new GrpcTransportFactory()],
    preferredTransports: flags.transport ? [flags.transport] : undefined,
    clientConfig: { plugins: [experiments(EXPERIMENT_ID)] },
  })
);
const client = await factory.createFromUrl(AGENT_URL);
console.log(
  `[client] ${client.transport.protocolName} to ${client.endpoint}, experiment=${EXPERIMENT_ID}`
);

let taskId = '';
const stream = client.sendMessageStream({
  tenant: '',
  message: {
    messageId: crypto.randomUUID(),
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: 'text', value: 'hi' },
        mediaType: 'text/plain',
        filename: '',
        metadata: undefined,
      },
    ],
    contextId: '',
    taskId: '',
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  },
  configuration: undefined,
  metadata: {},
});
for await (const { payload } of stream) {
  if (payload?.$case === 'task') taskId = payload.value.id;
  if (payload?.$case === 'artifactUpdate') {
    const [part] = payload.value.artifact?.parts ?? [];
    if (part?.content?.$case === 'text')
      console.log(`[client] agent replied: ${part.content.value}`);
  }
}

const task: Task = await client.getTask({ tenant: '', id: taskId, historyLength: undefined });
console.log(`[client] task ${taskId.slice(0, 8)} is ${taskStateToJSON(task.status?.state ?? 0)}`);

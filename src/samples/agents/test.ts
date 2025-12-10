import { v4 as uuidv4 } from 'uuid';
import { ClientFactory } from '../../client/factory.js';
import { MessageSendParams } from '../../types.js';
// ... other imports ...

const factory = new ClientFactory();

// createFromUrl accepts baseUrl and optional path,
// (the default path is /.well-known/agent-card.json)
const client = await factory.createFromUrl('http://localhost:4000');

async function streamTask() {
  const streamParams: MessageSendParams = {
    message: {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text: 'Stream me some updates!' }],
      kind: 'message',
    },
  };

  try {
    const stream = client.sendMessageStream(streamParams);

    for await (const event of stream) {
      if (event.kind === 'task') {
        console.log(`[${event.id}] Task created. Status: ${event.status.state}`);
      } else if (event.kind === 'status-update') {
        console.log(`[${event.taskId}] Status Updated: ${event.status.state}`);
      } else if (event.kind === 'artifact-update') {
        console.log(`[${event.taskId}] Artifact Received: ${event.artifact.artifactId}`);
      }
    }
    console.log('--- Stream finished ---');
  } catch (error) {
    console.error('Error during streaming:', error);
  }
}

await streamTask();

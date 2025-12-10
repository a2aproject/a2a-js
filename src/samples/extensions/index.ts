import express from 'express';

import { AGENT_CARD_PATH, AgentCard } from '../../index.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  DefaultRequestHandler,
} from '../../server/index.js';
import { jsonRpcHandler, agentCardHandler, UserBuilder } from '../../server/express/index.js';
import { TimestampingAgentExecutor } from './extensions.js';
import { SampleAgentExecutor } from '../agents/sample-agent/agent_executor.js';

// --- Server Setup ---

const extensionAgentCard: AgentCard = {
  name: 'Sample Agent with timestamp extensions',
  description:
    'A sample agent to test the stream functionality and simulate the flow of tasks statuses, with extensions integration.',
  url: 'http://localhost:41241/',
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples', // Added provider URL
  },
  version: '1.0.0', // Incremented version
  protocolVersion: '0.3.0',
  capabilities: {
    extensions: [{ uri: 'https://github.com/a2aproject/a2a-js/src/samples/extensions/v1' }],
    streaming: true, // The new framework supports streaming
    pushNotifications: false, // Assuming not implemented for this agent yet
    stateTransitionHistory: true, // Agent uses history
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'], // task-status is a common output mode
  skills: [
    {
      id: 'sample_agent',
      name: 'Sample Agent with extensions',
      description: 'Simulate the general flow of a streaming agent with extensions integration.',
      tags: ['sample'],
      examples: ['hi', 'hello world', 'how are you', 'goodbye'],
      inputModes: ['text'], // Explicitly defining for skill
      outputModes: ['text', 'task-status'], // Explicitly defining for skill
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

async function main() {
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  const agentExecutor: AgentExecutor = new SampleAgentExecutor();

  // 3. Use the TimestampingAgentExecutor to wrap the AgentExecutor
  const timestampAgentExecutor: AgentExecutor = new TimestampingAgentExecutor(agentExecutor);

  // 4. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(
    extensionAgentCard,
    taskStore,
    timestampAgentExecutor
  );

  // 5. Create and setup Express.js app
  const app = express();

  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  // 6. Start the server
  const PORT = process.env.PORT || 41241;
  app.listen(PORT, (err) => {
    if (err) {
      throw err;
    }
    console.log(
      `[ExtensionsSampleAgent] Server using new framework started on http://localhost:${PORT}`
    );
    console.log(
      `[ExtensionsSampleAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`
    );
    console.log('[ExtensionsSampleAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);

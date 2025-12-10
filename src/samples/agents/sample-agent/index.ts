import express from 'express';
import { AgentCard, AGENT_CARD_PATH } from '../../../index.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  DefaultRequestHandler,
} from '../../../server/index.js';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '../../../server/express/index.js';
import { SampleAgentExecutor } from './agent_executor.js';

// --- Server Setup ---

const sampleAgentCard: AgentCard = {
  name: 'Sample Agent',
  description:
    'A sample agent to test the stream functionality and simulate the flow of tasks statuses.',
  url: 'http://localhost:41241/',
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples', // Added provider URL
  },
  version: '1.0.0', // Incremented version
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: true, // The new framework supports streaming
    pushNotifications: false, // Assuming not implemented for this agent yet
    stateTransitionHistory: true, // Agent uses history
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'], // task-status is a common output mode
  skills: [
    {
      id: 'sample_agent',
      name: 'Sample Agent',
      description: 'Simulate the general flow of a streaming agent.',
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

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(sampleAgentCard, taskStore, agentExecutor);

  // 4. Create and setup Express app
  const app = express();

  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  // 5. Start the server
  const PORT = process.env.PORT || 41241;
  app.listen(PORT, (err) => {
    if (err) {
      throw err;
    }
    console.log(`[SampleAgent] Server using new framework started on http://localhost:${PORT}`);
    console.log(`[SampleAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
    console.log('[SampleAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);

import express from 'express';
import { AgentCard } from '../../index.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  DefaultRequestHandler,
} from '../../server/index.js';
import { AuthenticationAgentExecutor } from './agent_executor.js';
import { userBuilder } from './user_builder.js';
import { authenticationHandler } from './authentication_middleware.js';
import { jsonRpcHandler } from '../../server/express/json_rpc_handler.js';

// --- Server Setup ---

const authenticationAgentCard: AgentCard = {
  name: 'Sample Authentication Agent',
  description: 'A sample agent to test the authentication functionality',
  // Adjust the base URL and port as needed. /a2a is the default base in A2AExpressApp
  url: 'http://localhost:41241/',
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples',
  },
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: {
    stateTransitionHistory: true, // Agent uses history
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'],
  skills: [
    {
      id: 'sample_agent',
      name: 'Sample Agent',
      description: 'Simulate the general flow of an agent with authentication feature.',
      tags: ['sample'],
      examples: ['hello, who am i?'],
      inputModes: ['text'],
      outputModes: ['text', 'task-status'],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
  security: [{ Bearer: [] }],
  securitySchemes: { Bearer: { type: 'http', scheme: 'bearer' } },
};

async function main() {
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  const agentExecutor: AgentExecutor = new AuthenticationAgentExecutor();

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(
    authenticationAgentCard,
    taskStore,
    agentExecutor
  );

  // 4. Create and setup express app, with authentication middleware and user builder
  const app = express();
  app.use(express.json());
  app.use(authenticationHandler);
  app.use(
    jsonRpcHandler({
      requestHandler,
      userBuilder,
    })
  );

  // 5. Start the server
  const PORT = process.env.PORT || 41241;
  app.listen(PORT, (err: unknown) => {
    if (err) {
      throw err;
    }
    console.log(
      `[AuthenticationAgent] Server using new framework started on http://localhost:${PORT}`
    );
    console.log(
      `[AuthenticationAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`
    );
    console.log('[AuthenticationAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);

import express from 'express';

import { A2A_PROTOCOL_VERSION, AGENT_CARD_PATH, AgentCard } from '../../../index.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  DefaultRequestHandler,
} from '../../../server/index.js';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '../../../server/express/index.js';
import { CancellableAgentExecutor } from './agent_executor.js';

const PORT = Number(process.env.PORT || 41241);

const cancellableAgentCard: AgentCard = {
  name: 'Sample Cancellable Agent',
  description:
    'A sample agent that runs a multi-step task and supports user-initiated ' +
    'cancellation via the A2A Cancel Task operation ' +
    '(`CancelTask` over JSON-RPC, `POST /tasks/{id}:cancel` over HTTP+JSON/REST).',
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
    pushNotifications: false,
    extensions: [],
    extendedAgentCard: false,
  },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'],
  skills: [
    {
      id: 'cancellable_task',
      name: 'Cancellable Task',
      description: 'Runs a multi-step long task that can be cancelled mid-flight.',
      tags: ['cancellation', 'long-running'],
      examples: ['start a long task'],
      inputModes: ['text'],
      outputModes: ['text', 'task-status'],
      securityRequirements: [],
    },
  ],
  documentationUrl: '',
  signatures: [],
};

async function main() {
  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new CancellableAgentExecutor();
  const requestHandler = new DefaultRequestHandler(cancellableAgentCard, taskStore, agentExecutor);

  const app = express();
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  app.listen(PORT, (err) => {
    if (err) {
      throw err;
    }
    console.log(`[CancellableAgent] Server started on http://localhost:${PORT}`);
    console.log(
      `[CancellableAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`
    );
    console.log('[CancellableAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);

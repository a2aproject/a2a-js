import express from 'express';
import { Server, ServerCredentials } from '@grpc/grpc-js';

import { A2A_PROTOCOL_VERSION, AGENT_CARD_PATH, AgentCard } from '../../../index.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  DefaultRequestHandler,
} from '../../../server/index.js';
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from '../../../server/express/index.js';
import { grpcService, A2AService } from '../../../server/grpc/index.js';
import { SampleAgentExecutor } from '../sample-agent/agent_executor.js';

// --- Configuration ---

const HTTP_PORT = Number(process.env.HTTP_PORT || 41241);
const GRPC_PORT = Number(process.env.GRPC_PORT || 41242);

// --- Agent Card ---
//
// Lists all three protocol bindings exposed by this agent so that A2A clients
// can pick whichever transport they prefer. `ClientFactory.createFromAgentCard`
// chooses the highest-priority interface that matches a registered transport
// factory on the client.

const multiTransportAgentCard: AgentCard = {
  name: 'Sample Multi-Transport Agent',
  description:
    'A sample agent exposing the same A2A surface over JSON-RPC, HTTP+JSON ' +
    'REST, and gRPC simultaneously.',
  supportedInterfaces: [
    {
      url: `http://localhost:${HTTP_PORT}/a2a/jsonrpc`,
      protocolBinding: 'JSONRPC',
      tenant: '',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
    {
      url: `http://localhost:${HTTP_PORT}/a2a/rest`,
      protocolBinding: 'HTTP+JSON',
      tenant: '',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
    {
      url: `localhost:${GRPC_PORT}`,
      protocolBinding: 'GRPC',
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
      id: 'sample_agent',
      name: 'Sample Agent',
      description: 'Reuses the SampleAgentExecutor across all transports.',
      tags: ['sample', 'multi-transport'],
      examples: ['hi', 'hello', 'how are you'],
      inputModes: ['text'],
      outputModes: ['text', 'task-status'],
      securityRequirements: [],
    },
  ],
  documentationUrl: '',
  signatures: [],
};

async function main() {
  // 1. Shared infrastructure: one TaskStore, one AgentExecutor, one
  //    DefaultRequestHandler. All three transport handlers are thin adapters
  //    over this single request handler instance.
  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new SampleAgentExecutor();
  const requestHandler = new DefaultRequestHandler(
    multiTransportAgentCard,
    taskStore,
    agentExecutor
  );

  // 2. Express app: JSON-RPC + REST + AgentCard.
  const app = express();
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(
    '/a2a/jsonrpc',
    jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );
  app.use('/a2a/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  app.listen(HTTP_PORT, (err) => {
    if (err) {
      throw err;
    }
    console.log(`[MultiTransportAgent] HTTP server started on http://localhost:${HTTP_PORT}`);
    console.log(`  JSON-RPC : http://localhost:${HTTP_PORT}/a2a/jsonrpc`);
    console.log(`  REST     : http://localhost:${HTTP_PORT}/a2a/rest`);
    console.log(`  Card     : http://localhost:${HTTP_PORT}/${AGENT_CARD_PATH}`);
  });

  // 3. gRPC server on a separate port.
  const grpcServer = new Server();
  grpcServer.addService(
    A2AService,
    grpcService({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );
  grpcServer.bindAsync(`localhost:${GRPC_PORT}`, ServerCredentials.createInsecure(), (err) => {
    if (err) {
      console.error(`[MultiTransportAgent] gRPC bind failed:`, err);
      return;
    }
    console.log(`[MultiTransportAgent] gRPC server started on localhost:${GRPC_PORT}`);
  });

  console.log('[MultiTransportAgent] Press Ctrl+C to stop the server');
}

main().catch(console.error);

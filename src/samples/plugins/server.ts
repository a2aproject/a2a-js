import express from 'express';
import { Server, ServerCredentials } from '@grpc/grpc-js';

import { A2A_PROTOCOL_VERSION, AGENT_CARD_PATH, AgentCard } from '../../index.js';
import {
  AgentExecutor,
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryTaskStore,
  RequestContext,
} from '../../server/index.js';
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from '../../server/express/index.js';
import { A2AService, grpcService } from '../../server/grpc/index.js';
import { SampleAgentExecutor } from '../agents/sample-agent/agent_executor.js';
import { audit, experimentScope, logWithExperiment, timing } from './plugins.js';

/**
 * Serves the sample agent over JSON-RPC, REST and gRPC with three server
 * plugins installed on the shared `DefaultRequestHandler`. Run the client in
 * another terminal: `npm run agents:plugins-client`.
 */

const HTTP_PORT = Number(process.env.HTTP_PORT || 41241);
const GRPC_PORT = Number(process.env.GRPC_PORT || 41242);

const agentCard: AgentCard = {
  name: 'Plugins Agent',
  description: 'The sample agent with server plugins installed.',
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
  provider: { organization: 'A2A Samples', url: 'https://example.com/a2a-samples' },
  version: '1.0.0',
  capabilities: { streaming: true, pushNotifications: false, extensions: [] },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [
    {
      id: 'greet',
      name: 'Greet',
      description: 'Responds with a greeting.',
      tags: ['sample', 'plugins'],
      examples: ['hi'],
      inputModes: ['text'],
      outputModes: ['text'],
      securityRequirements: [],
    },
  ],
  documentationUrl: '',
  signatures: [],
};

/** The sample agent; its log line shows the experiment set by `experimentScope`. */
class LoggingAgent implements AgentExecutor {
  private readonly inner = new SampleAgentExecutor();

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    logWithExperiment(`handling task ${requestContext.taskId.slice(0, 8)}`);
    await this.inner.execute(requestContext, eventBus);
  }

  cancelTask = (taskId: string, eventBus: ExecutionEventBus) =>
    this.inner.cancelTask(taskId, eventBus);
}

const requestHandler = new DefaultRequestHandler(
  agentCard,
  new InMemoryTaskStore(),
  new LoggingAgent(),
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  { plugins: [audit, timing, experimentScope] }
);
const userBuilder = UserBuilder.noAuthentication;

const app = express();
app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder }));
app.use('/a2a/rest', restHandler({ requestHandler, userBuilder }));
app.listen(HTTP_PORT, (err) => {
  if (err) throw err;
  console.log(`[PluginsAgent] JSON-RPC and REST on http://localhost:${HTTP_PORT}`);
});

const grpcServer = new Server();
grpcServer.addService(A2AService, grpcService({ requestHandler, userBuilder }));
grpcServer.bindAsync(`localhost:${GRPC_PORT}`, ServerCredentials.createInsecure(), (err) => {
  if (err) throw err;
  console.log(`[PluginsAgent] gRPC on localhost:${GRPC_PORT}`);
});

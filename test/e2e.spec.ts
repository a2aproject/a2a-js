import express, { Express } from 'express';
import * as grpc from '@grpc/grpc-js';
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import {
  AgentExecutionEvent,
  AgentExecutor,
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryTaskStore,
  RequestContext,
} from '../src/server/index.js';
import { AgentCard, Message } from '../src/types.js';
import { agentCardHandler } from '../src/server/express/agent_card_handler.js';
import { jsonRpcHandler } from '../src/server/express/json_rpc_handler.js';
import { restHandler } from '../src/server/express/rest_handler.js';
import { ClientFactory, ClientFactoryOptions } from '../src/client/factory.js';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { A2AStreamEventData } from '../src/client/client.js';
import { UserBuilder } from '../src/server/express/common.js';
import { A2AService, grpcService } from '../src/server/grpc/index.js';
import { GrpcTransportFactory } from '../src/client/transports/grpc/grpc_transport.js';

class TestAgentExecutor implements AgentExecutor {
  constructor(public events: AgentExecutionEvent[] = []) {}

  async execute(_requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    for (const message of this.events) {
      eventBus.publish(message);
    }
  }

  cancelTask: (taskId: string, eventBus: ExecutionEventBus) => Promise<void>;
}

interface TransportConfig {
  name: string;
  preferredTransport: string;
  serverPath?: string;
}

const transportConfigs: TransportConfig[] = [
  {
    name: 'JSON-RPC',
    preferredTransport: 'JSONRPC',
    serverPath: '/a2a/rpc',
  },
  {
    name: 'REST',
    preferredTransport: 'HTTP+JSON',
    serverPath: '/a2a/rest',
  },
  {
    name: 'GRPC',
    preferredTransport: 'GRPC',
  },
];

describe('Client E2E tests', () => {
  const clientFactory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new GrpcTransportFactory()],
    })
  );

  transportConfigs.forEach((transportConfig) => {
    describe(`[${transportConfig.name}]`, () => {
      let app: Express;
      let server: Server;
      let grpcServer: grpc.Server;
      let agentExecutor: TestAgentExecutor;
      let agentCard: AgentCard;

      beforeEach(async () => {
        agentExecutor = new TestAgentExecutor();
        agentCard = {
          protocolVersion: '0.3.0',
          name: 'Test Agent',
          description: 'An agent for testing purposes',
          preferredTransport: transportConfig.preferredTransport,
          url: 'localhost',
          version: '1.0.0',
          capabilities: {
            streaming: true,
            pushNotifications: true,
          },
          defaultInputModes: ['text/plain'],
          defaultOutputModes: ['text/plain'],
          skills: [],
        };
        const requestHandler = new DefaultRequestHandler(
          agentCard,
          new InMemoryTaskStore(),
          agentExecutor
        );

        app = express();

        app.use(
          '/.well-known/agent-card.json',
          agentCardHandler({ agentCardProvider: requestHandler })
        );

        app.use(
          '/a2a/rpc',
          jsonRpcHandler({
            requestHandler: requestHandler,
            userBuilder: UserBuilder.noAuthentication,
          })
        );

        app.use(
          '/a2a/rest',
          restHandler({ requestHandler: requestHandler, userBuilder: UserBuilder.noAuthentication })
        );

        server = app.listen();
        const address = server.address() as AddressInfo;
        agentCard.url = `http://localhost:${address.port}${transportConfig.serverPath}`;

        grpcServer = new grpc.Server();
        grpcServer.addService(
          A2AService,
          grpcService({
            requestHandler: requestHandler,
            userBuilder: UserBuilder.noAuthentication,
          })
        );
        await new Promise<void>((resolve, reject) => {
          grpcServer.bindAsync(
            `localhost:0`,
            grpc.ServerCredentials.createInsecure(),
            (error, port) => {
              if (error) {
                reject(error);
                return;
              }
              if (transportConfig.name === 'GRPC') {
                agentCard.url = `localhost:${port}`;
              }
              resolve();
            }
          );
        });
      });

      afterEach(() => {
        server.close();
        grpcServer.forceShutdown();
      });

      describe('sendMessage', () => {
        it('should send a message to the agent', async () => {
          const expected = createTestMessage('1', 'test');
          agentExecutor.events = [expected];
          const client = await clientFactory.createFromAgentCard(agentCard);

          const actual = await client.sendMessage({
            message: createTestMessage('1', 'test'),
          });
          expect(removeUndefinedFields(actual)).to.deep.equal(expected);
        });
      });

      describe('sendMessageStream', () => {
        it('should send a message to the agent and read event stream', async () => {
          const taskId = '1';
          const contextId = '2';
          const expected: AgentExecutionEvent[] = [
            {
              id: taskId,
              contextId,
              status: { state: 'submitted' },
              kind: 'task',
              artifacts: [],
              history: [],
            },
            {
              taskId,
              contextId,
              kind: 'status-update',
              status: { state: 'working' },
              final: false,
            },
            {
              taskId,
              contextId,
              kind: 'status-update',
              status: { state: 'completed' },
              final: true,
            },
          ];
          agentExecutor.events = expected;
          const client = await clientFactory.createFromAgentCard(agentCard);

          const actual: A2AStreamEventData[] = [];
          for await (const message of client.sendMessageStream({
            message: createTestMessage('1', 'test'),
          })) {
            actual.push(message);
          }

          expect(removeUndefinedFields(actual)).to.deep.equal(expected);
        });
      });
    });
  });
});

const removeUndefinedFields = (obj: any) => JSON.parse(JSON.stringify(obj));
function createTestMessage(id: string, text: string): Message {
  return {
    messageId: id,
    extensions: [],
    role: 'user',
    parts: [{ kind: 'text', text }],
    kind: 'message',
  };
}

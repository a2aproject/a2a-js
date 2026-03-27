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
import { AgentCard, Message, Role, TaskState, A2AStreamEventData } from '../src/index.js';
import { agentCardHandler } from '../src/server/express/agent_card_handler.js';
import { jsonRpcHandler } from '../src/server/express/json_rpc_handler.js';
import { restHandler } from '../src/server/express/rest_handler.js';
import { ClientFactory, ClientFactoryOptions } from '../src/client/factory.js';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { UserBuilder } from '../src/server/express/common.js';
import { A2AService, grpcService } from '../src/server/grpc/index.js';
import { GrpcTransportFactory } from '../src/client/transports/grpc/grpc_transport.js';

class TestAgentExecutor implements AgentExecutor {
  constructor(public events: AgentExecutionEvent[] = []) {}

  async execute(_requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    for (const message of this.events) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      eventBus.publish(message);
    }
  }

  cancelTask: (taskId: string, eventBus: ExecutionEventBus) => Promise<void>;
}

interface TransportConfig {
  name: string;  serverPath?: string;
}

const transportConfigs: TransportConfig[] = [
  {
    name: 'JSON-RPC',    serverPath: '/a2a/rpc',
  },
  {
    name: 'REST',    serverPath: '/a2a/rest',
  },
  {
    name: 'GRPC',  },
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
      let taskStore: InMemoryTaskStore;

      beforeEach(async () => {
        agentExecutor = new TestAgentExecutor();
        taskStore = new InMemoryTaskStore();
        agentCard = {          name: 'Test Agent',
          description: 'An agent for testing purposes',          supportedInterfaces: [], iconUrl: undefined,
          version: '1.0.0',
          capabilities: {
            streaming: true,
            pushNotifications: true,
            extensions: [],
          },
          defaultInputModes: ['text/plain'],
          defaultOutputModes: ['text/plain'],
          skills: [],          provider: { url: '', organization: '' },
          documentationUrl: '',
          securitySchemes: {},
          securityRequirements: [],          signatures: [],
        };
        const requestHandler = new DefaultRequestHandler(
          agentCard,
          taskStore,
          agentExecutor
        );

        // Seed initial task for testing
        const initialTask: Task = {
          id: 'task-123',
          contextId: 'context-123',
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
          artifacts: [],
          history: [],
          metadata: {},
        };
        await taskStore.save(initialTask);

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
        agentCard.supportedInterfaces = [{
          url: `http://localhost:${address.port}${transportConfig.serverPath}`,
          protocolBinding: transportConfig.name === 'JSON-RPC' ? 'JSONRPC' : (transportConfig.name === 'REST' ? 'HTTP+JSON' : 'GRPC'),
          protocolVersion: '0.1.0',
          tenant: ''
        }];

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
                agentCard.supportedInterfaces = [{
                  url: `localhost:${port}`,
                  protocolBinding: 'GRPC',
                  protocolVersion: '0.1.0',
                  tenant: ''
                }];
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
          const expected = createTestMessage('1', 'test', 'task-123');
          agentExecutor.events = [expected];
          const client = await clientFactory.createFromAgentCard(agentCard);

          const actual = await client.sendMessage({
            message: createTestMessage('1', 'test', 'task-123'),
            configuration: undefined,
            metadata: {}, 
            tenant: '',
          });
          expect(removeUndefinedFields(actual)).to.deep.equal(removeUndefinedFields(expected));
        });
      });

      describe('sendMessageStream', () => {
        it('should send a message to the agent and read event stream', async () => {
          const taskId = 'task-123';
          const contextId = '2';
          const expected: AgentExecutionEvent[] = [
            {
              id: taskId,
              contextId,
              status: {
                state: TaskState.TASK_STATE_SUBMITTED,
                message: undefined,
                timestamp: undefined,
              },
              artifacts: [],
              history: [],
              metadata: {}, 
            },
            {
              taskId,
              contextId,
              status: {
                state: TaskState.TASK_STATE_WORKING,
                message: undefined,
                timestamp: undefined,
              },
              metadata: {}, 
            },
            {
              taskId,
              contextId,
              status: {
                state: TaskState.TASK_STATE_COMPLETED,
                message: undefined,
                timestamp: undefined,
              },
              metadata: {}, 
            },
          ];
          agentExecutor.events = expected;
          const client = await clientFactory.createFromAgentCard(agentCard);

          const actual: A2AStreamEventData[] = [];
          for await (const message of client.sendMessageStream({
            message: createTestMessage('1', 'test', taskId),
            configuration: undefined,
            metadata: {}, 
            tenant: '',
          })) {
            actual.push(message);
          }

          expect(removeUndefinedFields(actual)).to.deep.equal(removeUndefinedFields(expected));
        });

        it('should fallback to non-streaming sendMessage if agent does not support streaming', async () => {
          agentCard.capabilities.streaming = false;
          const requestMessage = createTestMessage('1', 'request-message', 'task-123');
          const responseMessage = createTestMessage('2', 'response-message', 'task-123');
          agentExecutor.events = [responseMessage];
          const client = await clientFactory.createFromAgentCard(agentCard);

          const actual: A2AStreamEventData[] = [];
          for await (const message of client.sendMessageStream({
            message: requestMessage,
            configuration: undefined,
            metadata: {}, 
            tenant: '',
          })) {
            actual.push(message);
          }

          expect(actual).to.have.lengthOf(1);
          expect(removeUndefinedFields(actual[0])).to.deep.equal(responseMessage);
        });
      });
    });
  });
});

const removeUndefinedFields = (obj: any) => JSON.parse(JSON.stringify(obj));
function createTestMessage(id: string, text: string, taskId: string = ''): Message {
  return {
    messageId: id,
    extensions: [],
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: 'text', value: text },
        metadata: {},
        filename: '',
        mediaType: '',
      },
    ],
    contextId: '',
    taskId: taskId,
    metadata: {}, referenceTaskIds: [],
  };
}

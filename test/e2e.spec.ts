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
import { AgentEvent } from '../src/server/events/execution_event_bus.js';
import { AgentCard, Message, Role, Task, TaskState, StreamResponse } from '../src/index.js';
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
          name: 'Test Agent',
          description: 'An agent for testing purposes',
          version: '1.0.0',
          supportedInterfaces: [
            {
              url: 'localhost',
              protocolBinding: transportConfig.preferredTransport,
              tenant: '',
              protocolVersion: '1.0.0',
            },
          ],
          capabilities: {
            streaming: true,
            pushNotifications: true,
            extensions: [],
          },
          defaultInputModes: ['text/plain'],
          defaultOutputModes: ['text/plain'],
          skills: [],
          provider: { url: '', organization: '' },
          documentationUrl: '',
          securityRequirements: [],
          securitySchemes: {},
          signatures: [],
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
        agentCard.supportedInterfaces![0].url = `http://localhost:${address.port}${transportConfig.serverPath}`;

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
                agentCard.supportedInterfaces![0].url = `localhost:${port}`;
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
          agentExecutor.events = [AgentEvent.message(expected)];
          const client = await clientFactory.createFromAgentCard(agentCard);

          const actual = await client.sendMessage({
            tenant: '',
            message: createTestMessage('1', 'test'),
            configuration: undefined,
            metadata: {},
          });
          expect(removeUndefinedFields(actual)).to.deep.equal(removeUndefinedFields(expected));
        });
      });

      describe('sendMessageStream', () => {
        it('should send a message to the agent and read event stream', async () => {
          const taskId = '1';
          const contextId = '2';
          const expected: StreamResponse[] = [
            {
              payload: {
                $case: 'task',
                value: {
                  id: taskId,
                  contextId,
                  status: {
                    state: TaskState.TASK_STATE_SUBMITTED,
                    timestamp: undefined,
                    message: undefined,
                  },
                  artifacts: [],
                  history: [createTestMessage('1', 'test')],
                  metadata: {},
                },
              },
            },
            {
              payload: {
                $case: 'statusUpdate',
                value: {
                  taskId,
                  contextId,
                  status: {
                    state: TaskState.TASK_STATE_WORKING,
                    timestamp: undefined,
                    message: undefined,
                  },
                  metadata: {},
                },
              },
            },
            {
              payload: {
                $case: 'statusUpdate',
                value: {
                  taskId,
                  contextId,
                  status: {
                    state: TaskState.TASK_STATE_COMPLETED,
                    timestamp: undefined,
                    message: undefined,
                  },
                  metadata: {},
                },
              },
            },
          ];
          agentExecutor.events = expected.map((e: any) => {
            const $case = e.payload!.$case;
            const value = e.payload!.value;
            switch ($case) {
              case 'message':
                return AgentEvent.message(value);
              case 'task':
                return AgentEvent.task(value);
              case 'statusUpdate':
                return AgentEvent.statusUpdate(value);
              case 'artifactUpdate':
                return AgentEvent.artifactUpdate(value);
              default:
                throw new Error(`Unknown $case: ${$case}`);
            }
          });
          const client = await clientFactory.createFromAgentCard(agentCard);

          const actual: StreamResponse[] = [];
          for await (const message of client.sendMessageStream({
            tenant: '',
            message: createTestMessage('1', 'test'),
            configuration: undefined,
            metadata: {},
          })) {
            actual.push(message);
          }

          expect(removeUndefinedFields(actual)).to.deep.equal(removeUndefinedFields(expected));
        });

        it('should fallback to non-streaming sendMessage if agent does not support streaming', async () => {
          agentCard.capabilities.streaming = false;
          const requestMessage = createTestMessage('1', 'request-message');
          const responseMessage = createTestMessage('2', 'response-message');
          agentExecutor.events = [AgentEvent.message(responseMessage)];
          const client = await clientFactory.createFromAgentCard(agentCard);

          const actual: StreamResponse[] = [];
          for await (const message of client.sendMessageStream({
            tenant: '',
            message: requestMessage,
            configuration: undefined,
            metadata: {},
          })) {
            actual.push(message);
          }

          expect(actual).to.have.lengthOf(1);
          expect(removeUndefinedFields(actual[0])).to.deep.equal(
            removeUndefinedFields({
              payload: {
                $case: 'message',
                value: responseMessage,
              },
            })
          );
        });
      });
    });
  });
});

describe('Multi-tenancy E2E tests', () => {
  // Only REST supports tenant-prefixed URL routing. JSON-RPC uses body params,
  // and gRPC uses request message fields (both tested via the transport handler unit tests).
  describe('[REST] tenant-scoped routing', () => {
    let app: Express;
    let server: Server;
    let agentExecutor: TestAgentExecutor;
    let agentCard: AgentCard;
    let clientFactory: ClientFactory;

    beforeEach(async () => {
      agentExecutor = new TestAgentExecutor();
      agentCard = {
        name: 'Test Agent',
        description: 'A multi-tenant test agent',
        version: '1.0.0',
        supportedInterfaces: [
          {
            url: 'localhost',
            protocolBinding: 'HTTP+JSON',
            tenant: 'test-tenant',
            protocolVersion: '1.0.0',
          },
        ],
        capabilities: {
          streaming: true,
          pushNotifications: true,
          extensions: [],
        },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [],
        provider: { url: '', organization: '' },
        documentationUrl: '',
        securityRequirements: [],
        securitySchemes: {},
        signatures: [],
      };
      const requestHandler = new DefaultRequestHandler(
        agentCard,
        new InMemoryTaskStore(),
        agentExecutor
      );

      app = express();
      app.use(
        '/a2a/rest',
        restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication })
      );

      server = app.listen();
      const address = server.address() as AddressInfo;
      agentCard.supportedInterfaces![0].url = `http://localhost:${address.port}/a2a/rest`;
      clientFactory = new ClientFactory();
    });

    afterEach(() => {
      server.close();
    });

    it('should send a message via tenant-prefixed route and retrieve the task', async () => {
      const tenant = 'test-tenant';
      agentExecutor.events = [
        AgentEvent.task({
          id: '1',
          contextId: '2',
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            timestamp: undefined,
            message: undefined,
          },
          artifacts: [],
          history: [],
          metadata: {},
        }),
        AgentEvent.statusUpdate({
          taskId: '1',
          contextId: '2',
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            timestamp: undefined,
            message: undefined,
          },
          metadata: {},
        }),
      ];
      const client = await clientFactory.createFromAgentCard(agentCard);

      const result = await client.sendMessage({
        tenant,
        message: createTestMessage('msg-1', 'Hello from tenant'),
        configuration: undefined,
        metadata: {},
      });

      // Result should be a Task (not a Message) since we published task events
      expect('id' in result).to.equal(true);
      const task = result as Task;
      expect(task.status?.state).to.equal(TaskState.TASK_STATE_COMPLETED);

      // Should be able to retrieve the task via the same tenant
      const retrieved = await client.getTask({
        id: task.id,
        tenant,
        historyLength: 10,
      });
      expect(retrieved.id).to.equal(task.id);
    });

    it('should isolate tasks between tenants', async () => {
      const requestHandler = new DefaultRequestHandler(
        agentCard,
        new InMemoryTaskStore(),
        agentExecutor
      );

      // Create a separate server with a fresh store
      const isolationApp = express();
      isolationApp.use(
        '/a2a/rest',
        restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication })
      );
      const isolationServer = isolationApp.listen();
      const address = isolationServer.address() as AddressInfo;

      try {
        const baseUrl = `http://localhost:${address.port}/a2a/rest`;

        // Send message as tenant-A
        agentExecutor.events = [
          AgentEvent.task({
            id: 'task-a',
            contextId: 'ctx-a',
            status: {
              state: TaskState.TASK_STATE_SUBMITTED,
              timestamp: undefined,
              message: undefined,
            },
            artifacts: [],
            history: [],
            metadata: {},
          }),
          AgentEvent.statusUpdate({
            taskId: 'task-a',
            contextId: 'ctx-a',
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              timestamp: undefined,
              message: undefined,
            },
            metadata: {},
          }),
        ];

        const tenantACard = {
          ...agentCard,
          supportedInterfaces: [
            {
              url: baseUrl,
              protocolBinding: 'HTTP+JSON',
              tenant: 'tenant-A',
              protocolVersion: '1.0.0',
            },
          ],
        };
        const clientA = await clientFactory.createFromAgentCard(tenantACard);
        const resultA = await clientA.sendMessage({
          tenant: 'tenant-A',
          message: createTestMessage('msg-a', 'Hello from A'),
          configuration: undefined,
          metadata: {},
        });
        expect('id' in resultA).to.equal(true);

        // Try to get tenant-A's task as tenant-B -- should fail
        const tenantBCard = {
          ...agentCard,
          supportedInterfaces: [
            {
              url: baseUrl,
              protocolBinding: 'HTTP+JSON',
              tenant: 'tenant-B',
              protocolVersion: '1.0.0',
            },
          ],
        };
        const clientB = await clientFactory.createFromAgentCard(tenantBCard);
        try {
          await clientB.getTask({
            id: (resultA as any).id,
            tenant: 'tenant-B',
            historyLength: 0,
          });
          // Should not reach here
          expect.fail('Expected TaskNotFoundError');
        } catch (error: unknown) {
          expect((error as Error).name).to.equal('TaskNotFoundError');
        }
      } finally {
        isolationServer.close();
      }
    });
  });
});

const removeUndefinedFields = (obj: any) => JSON.parse(JSON.stringify(obj));
function createTestMessage(id: string, text: string): Message {
  return {
    messageId: id,
    extensions: [],
    role: Role.ROLE_USER,
    parts: [
      {
        content: {
          $case: 'text',
          value: text,
        },
        filename: '',
        mediaType: '',
        metadata: undefined,
      },
    ],
    contextId: '',
    taskId: '',
    metadata: undefined,
    referenceTaskIds: [],
  };
}

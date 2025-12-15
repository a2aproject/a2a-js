import { describe, it, beforeEach, expect, vi, Mock } from 'vitest';
import { Client, ClientConfig, RequestOptions } from '../../src/client/multitransport-client.js';
import { Transport } from '../../src/client/transports/transport.js';
import {
  MessageSendParams,
  TaskPushNotificationConfig,
  DeleteTaskPushNotificationConfigParams,
  ListTaskPushNotificationConfigParams,
  TaskIdParams,
  TaskQueryParams,
  Task,
  Message,
  TaskStatusUpdateEvent,
  AgentCard,
  GetTaskPushNotificationConfigParams,
} from '../../src/types.js';
import { A2AStreamEventData } from '../../src/client/client.js';
import { ClientCallResult } from '../../src/client/interceptors.js';

describe('Client', () => {
  let transport: Record<keyof Transport, Mock>;
  let client: Client;
  let agentCard: AgentCard;

  beforeEach(() => {
    transport = {
      getExtendedAgentCard: vi.fn(),
      sendMessage: vi.fn(),
      sendMessageStream: vi.fn(),
      setTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfig: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      resubscribeTask: vi.fn(),
    };
    agentCard = {
      protocolVersion: '0.3.0',
      name: 'Test Agent',
      description: 'Test Description',
      url: 'http://test-agent.com',
      version: '1.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: true,
      },
      defaultInputModes: [],
      defaultOutputModes: [],
      skills: [],
    };
    client = new Client(transport, agentCard);
  });

  it('should call transport.getAuthenticatedExtendedAgentCard', async () => {
    const agentCardWithExtendedSupport = { ...agentCard, supportsAuthenticatedExtendedCard: true };
    const extendedAgentCard: AgentCard = {
      ...agentCard,
      capabilities: { ...agentCard.capabilities, stateTransitionHistory: true },
    };
    client = new Client(transport, agentCardWithExtendedSupport);

    let caughtOptions;
    transport.getExtendedAgentCard.mockImplementation(async (options) => {
      caughtOptions = options;
      return extendedAgentCard;
    });

    const expectedOptions: RequestOptions = {
      serviceParameters: { key: 'value' },
    };
    const result = await client.getAgentCard(expectedOptions);

    expect(transport.getExtendedAgentCard).toHaveBeenCalledTimes(1);
    expect(result).to.equal(extendedAgentCard);
    expect(caughtOptions).to.equal(expectedOptions);
  });

  it('should not call transport.getAuthenticatedExtendedAgentCard if not supported', async () => {
    const result = await client.getAgentCard();

    expect(transport.getExtendedAgentCard).not.toHaveBeenCalled();
    expect(result).to.equal(agentCard);
  });

  it('should call transport.sendMessage with default blocking=true', async () => {
    const params: MessageSendParams = {
      message: {
        contextId: '123',
        kind: 'message',
        messageId: 'msg1',
        role: 'user',
        parts: [{ kind: 'text', text: 'hello' }],
      },
    };
    const response: Message = {
      kind: 'message',
      messageId: 'abc',
      role: 'agent',
      parts: [{ kind: 'text', text: 'response' }],
    };
    transport.sendMessage.mockResolvedValue(response);

    const result = await client.sendMessage(params);

    const expectedParams = {
      ...params,
      configuration: { ...params.configuration, blocking: true },
    };
    expect(transport.sendMessage.mock.contexts[0]).toBe(transport);
    expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    expect(result).to.deep.equal(response);
  });

  it('should call transport.sendMessageStream with blocking=true', async () => {
    const params: MessageSendParams = {
      message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
    };
    const events: A2AStreamEventData[] = [
      {
        kind: 'status-update',
        taskId: '123',
        contextId: 'ctx1',
        final: false,
        status: { state: 'working' },
      },
      {
        kind: 'status-update',
        taskId: '123',
        contextId: 'ctx1',
        final: false,
        status: { state: 'completed' },
      },
    ];
    async function* stream() {
      yield* events;
    }
    transport.sendMessageStream.mockReturnValue(stream());

    const result = client.sendMessageStream(params);

    const got = [];
    for await (const event of result) {
      got.push(event);
    }
    const expectedParams = {
      ...params,
      configuration: { ...params.configuration, blocking: true },
    };
    expect(transport.sendMessageStream).toHaveBeenCalledTimes(1);
    expect(transport.sendMessageStream).toHaveBeenCalledWith(expectedParams, undefined);
    expect(got).to.deep.equal(events);
  });

  it('should call transport.setTaskPushNotificationConfig', async () => {
    const params: TaskPushNotificationConfig = {
      taskId: '123',
      pushNotificationConfig: { url: 'http://example.com' },
    };
    transport.setTaskPushNotificationConfig.mockResolvedValue(params);

    const result = await client.setTaskPushNotificationConfig(params);

    expect(transport.setTaskPushNotificationConfig.mock.contexts[0]).toBe(transport);
    expect(transport.setTaskPushNotificationConfig).toHaveBeenCalledExactlyOnceWith(
      params,
      undefined
    );
    expect(result).to.equal(params);
  });

  it('should call transport.getTaskPushNotificationConfig', async () => {
    const params: GetTaskPushNotificationConfigParams = {
      id: '123',
      pushNotificationConfigId: 'abc',
    };
    const config: TaskPushNotificationConfig = {
      taskId: '123',
      pushNotificationConfig: { url: 'http://example.com' },
    };
    transport.getTaskPushNotificationConfig.mockResolvedValue(config);

    const result = await client.getTaskPushNotificationConfig(params);

    expect(transport.getTaskPushNotificationConfig.mock.contexts[0]).toBe(transport);
    expect(transport.getTaskPushNotificationConfig).toHaveBeenCalledExactlyOnceWith(
      params,
      undefined
    );
    expect(result).to.equal(config);
  });

  it('should call transport.listTaskPushNotificationConfig', async () => {
    const params: ListTaskPushNotificationConfigParams = { id: '123' };
    const configs: TaskPushNotificationConfig[] = [
      { taskId: '123', pushNotificationConfig: { url: 'http://example.com' } },
    ];
    transport.listTaskPushNotificationConfig.mockResolvedValue(configs);

    const result = await client.listTaskPushNotificationConfig(params);

    expect(transport.listTaskPushNotificationConfig).toHaveBeenCalledExactlyOnceWith(
      params,
      undefined
    );
    expect(result).to.equal(configs);
  });

  it('should call transport.deleteTaskPushNotificationConfig', async () => {
    const params: DeleteTaskPushNotificationConfigParams = {
      id: '123',
      pushNotificationConfigId: 'abc',
    };
    transport.deleteTaskPushNotificationConfig.mockResolvedValue(undefined);

    await client.deleteTaskPushNotificationConfig(params);

    expect(transport.deleteTaskPushNotificationConfig.mock.contexts[0]).toBe(transport);
    expect(transport.deleteTaskPushNotificationConfig).toHaveBeenCalledExactlyOnceWith(
      params,
      undefined
    );
  });

  it('should call transport.getTask', async () => {
    const params: TaskQueryParams = { id: '123' };
    const task: Task = { id: '123', kind: 'task', contextId: 'ctx1', status: { state: 'working' } };
    transport.getTask.mockResolvedValue(task);

    const result = await client.getTask(params);

    expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, undefined);
    expect(result).to.equal(task);
  });

  it('should call transport.cancelTask', async () => {
    const params: TaskIdParams = { id: '123' };
    const task: Task = {
      id: '123',
      kind: 'task',
      contextId: 'ctx1',
      status: { state: 'canceled' },
    };
    transport.cancelTask.mockResolvedValue(task);

    const result = await client.cancelTask(params);

    expect(transport.cancelTask.mock.contexts[0]).toBe(transport);
    expect(transport.cancelTask).toHaveBeenCalledExactlyOnceWith(params, undefined);
    expect(result).to.equal(task);
  });

  it('should call transport.resubscribeTask', async () => {
    const params: TaskIdParams = { id: '123' };
    const events: TaskStatusUpdateEvent[] = [
      {
        kind: 'status-update',
        taskId: '123',
        contextId: 'ctx1',
        final: false,
        status: { state: 'working' },
      },
      {
        kind: 'status-update',
        taskId: '123',
        contextId: 'ctx1',
        final: true,
        status: { state: 'completed' },
      },
    ];
    async function* stream() {
      yield* events;
    }
    transport.resubscribeTask.mockReturnValue(stream());

    const result = client.resubscribeTask(params);

    const got = [];
    for await (const event of result) {
      got.push(event);
    }
    expect(transport.resubscribeTask.mock.contexts[0]).toBe(transport);
    expect(transport.resubscribeTask).toHaveBeenCalledExactlyOnceWith(params, undefined);
    expect(got).to.deep.equal(events);
  });

  describe('sendMessage', () => {
    it('should set blocking=false when polling is enabled', async () => {
      const config: ClientConfig = { polling: true };
      client = new Client(transport, agentCard, config);
      const params: MessageSendParams = {
        message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: { blocking: false },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });

    it('should set blocking=false when explicitly provided in request', async () => {
      client = new Client(transport, agentCard);
      const params: MessageSendParams = {
        message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
        configuration: { blocking: false },
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: { blocking: false },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });

    it('should apply acceptedOutputModes', async () => {
      const config: ClientConfig = { polling: false, acceptedOutputModes: ['application/json'] };
      client = new Client(transport, agentCard, config);
      const params: MessageSendParams = {
        message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: { blocking: true, acceptedOutputModes: ['application/json'] },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });

    it('should use acceptedOutputModes from request when provided', async () => {
      const config: ClientConfig = { polling: false, acceptedOutputModes: ['application/json'] };
      client = new Client(transport, agentCard, config);
      const params: MessageSendParams = {
        message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
        configuration: { acceptedOutputModes: ['text/plain'] },
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: { blocking: true, acceptedOutputModes: ['text/plain'] },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });

    it('should apply pushNotificationConfig', async () => {
      const pushConfig = { url: 'http://test.com' };
      const config: ClientConfig = { polling: false, pushNotificationConfig: pushConfig };
      client = new Client(transport, agentCard, config);
      const params: MessageSendParams = {
        message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: { blocking: true, pushNotificationConfig: pushConfig },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });

    it('should use pushNotificationConfig from request when provided', async () => {
      const config: ClientConfig = {
        polling: false,
        pushNotificationConfig: { url: 'http://test.com' },
      };
      client = new Client(transport, agentCard, config);
      const pushConfig = { url: 'http://test2.com' };
      const params: MessageSendParams = {
        message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
        configuration: { pushNotificationConfig: pushConfig },
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: { blocking: true, pushNotificationConfig: pushConfig },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });
  });

  describe('sendMessageStream', () => {
    it('should fallback to sendMessage if streaming is not supported', async () => {
      agentCard.capabilities.streaming = false;
      client = new Client(transport, agentCard);
      const params: MessageSendParams = {
        message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
      };
      const response: Message = {
        kind: 'message',
        messageId: '2',
        role: 'agent',
        parts: [],
      };
      transport.sendMessage.mockResolvedValue(response);

      const result = client.sendMessageStream(params);
      const yielded = await result.next();

      const expectedParams = {
        ...params,
        configuration: { blocking: true },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
      expect(yielded.value).to.deep.equal(response);
    });
  });

  describe('Interceptors', () => {
    it('should modify request', async () => {
      const config: ClientConfig = {
        interceptors: [
          {
            before: async (args) => {
              if (args.input.method === 'getTask') {
                args.input.value = { ...args.input.value, metadata: { foo: 'bar' } };
              }
            },
            after: async () => {},
          },
        ],
      };
      client = new Client(transport, agentCard, config);
      const params: TaskQueryParams = { id: '123' };
      const task: Task = {
        id: '123',
        kind: 'task',
        contextId: 'ctx1',
        status: { state: 'working' },
      };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(
        { id: '123', metadata: { foo: 'bar' } },
        undefined
      );
      expect(result).to.equal(task);
    });

    it('should modify response', async () => {
      const config: ClientConfig = {
        interceptors: [
          {
            before: async () => {},
            after: async (args) => {
              if (args.result.method === 'getTask') {
                args.result.value = { ...args.result.value, metadata: { foo: 'bar' } };
              }
            },
          },
        ],
      };
      client = new Client(transport, agentCard, config);
      const params: TaskQueryParams = { id: '123' };
      const task: Task = {
        id: '123',
        kind: 'task',
        contextId: 'ctx1',
        status: { state: 'working' },
      };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, undefined);
      expect(result).to.deep.equal({ ...task, metadata: { foo: 'bar' } });
    });

    it('should modify options', async () => {
      const config: ClientConfig = {
        interceptors: [
          {
            before: async (args) => {
              args.options = { context: { [Symbol.for('foo')]: 'bar' } };
            },
            after: async () => {},
          },
        ],
      };
      client = new Client(transport, agentCard, config);
      const params: TaskQueryParams = { id: '123' };
      const task: Task = {
        id: '123',
        kind: 'task',
        contextId: 'ctx1',
        status: { state: 'working' },
      };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, {
        context: { [Symbol.for('foo')]: 'bar' },
      });
      expect(result).to.equal(task);
    });

    it('should contain agent card', async () => {
      let caughtAgentCard;
      const config: ClientConfig = {
        interceptors: [
          {
            before: async (args) => {
              caughtAgentCard = args.agentCard;
            },
            after: async () => {},
          },
        ],
      };
      client = new Client(transport, agentCard, config);
      const params: TaskQueryParams = { id: '123' };
      const task: Task = {
        id: '123',
        kind: 'task',
        contextId: 'ctx1',
        status: { state: 'working' },
      };
      transport.getTask.mockResolvedValue(task);

      await client.getTask(params);
      expect(caughtAgentCard).to.equal(agentCard);
    });

    it('should return early from before', async () => {
      const task: Task = {
        id: '123',
        kind: 'task',
        contextId: 'ctx1',
        status: { state: 'working' },
      };
      const config: ClientConfig = {
        interceptors: [
          {
            before: async (args) => {
              args.earlyReturn = {
                method: 'getTask',
                value: task,
              };
            },
            after: async () => {},
          },
          {
            before: async (args) => {
              if (args.input.method === 'getTask') {
                args.input.value = { ...args.input.value, metadata: { foo: 'bar' } };
              }
            },
            after: async () => {},
          },
        ],
      };
      client = new Client(transport, agentCard, config);
      const params: TaskQueryParams = { id: '123' };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).not.toHaveBeenCalled();
      expect(result).to.equal(task);
    });

    it('should return early from after', async () => {
      const task: Task = {
        id: '123',
        kind: 'task',
        contextId: 'ctx1',
        status: { state: 'working' },
      };
      const config: ClientConfig = {
        interceptors: [
          {
            before: async () => {},
            after: async (args) => {
              if (args.result.method === 'getTask') {
                args.result.value = { ...args.result.value, metadata: { foo: 'bar' } };
              }
            },
          },
          {
            before: async () => {},
            after: async (args) => {
              args.earlyReturn = true;
            },
          },
        ],
      };
      client = new Client(transport, agentCard, config);
      const params: TaskQueryParams = { id: '123' };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, undefined);
      expect(result).to.equal(task);
    });

    it('should run after for interceptors executed in before for early return', async () => {
      const task: Task = {
        id: '123',
        kind: 'task',
        contextId: 'ctx1',
        status: { state: 'working' },
      };
      let firstAfterCalled = false;
      let secondAfterCalled = false;
      let thirdAfterCalled = false;
      const config: ClientConfig = {
        interceptors: [
          {
            before: async () => {},
            after: async () => {
              firstAfterCalled = true;
            },
          },
          {
            before: async (args) => {
              if (args.input.method === 'getTask') {
                args.earlyReturn = {
                  method: 'getTask',
                  value: task,
                };
              }
            },
            after: async () => {
              secondAfterCalled = true;
            },
          },
          {
            before: async () => {},
            after: async () => {
              thirdAfterCalled = true;
            },
          },
        ],
      };
      client = new Client(transport, agentCard, config);
      const params: TaskQueryParams = { id: '123' };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).not.toHaveBeenCalled();
      expect(firstAfterCalled).to.be.true;
      expect(secondAfterCalled).to.be.true;
      expect(thirdAfterCalled).to.be.false;
      expect(result).to.equal(task);
    });

    it('should intercept each iterator item', async () => {
      const params: MessageSendParams = {
        message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
      };
      const events: A2AStreamEventData[] = [
        {
          kind: 'status-update',
          taskId: '123',
          contextId: 'ctx1',
          final: false,
          status: { state: 'working' },
        },
        {
          kind: 'status-update',
          taskId: '123',
          contextId: 'ctx1',
          final: false,
          status: { state: 'completed' },
        },
      ];
      async function* stream() {
        yield* events;
      }
      transport.sendMessageStream.mockReturnValue(stream());
      const config: ClientConfig = {
        interceptors: [
          {
            before: async () => {},
            after: async (args) => {
              if (args.result.method === 'sendMessageStream') {
                args.result.value = {
                  ...args.result.value,
                  metadata: { foo: 'bar' },
                };
              }
            },
          },
        ],
      };
      client = new Client(transport, agentCard, config);

      const result = client.sendMessageStream(params);

      const got = [];
      for await (const event of result) {
        got.push(event);
      }
      const expectedParams = {
        ...params,
        configuration: { ...params.configuration, blocking: true },
      };
      expect(transport.sendMessageStream).toHaveBeenCalledExactlyOnceWith(
        expectedParams,
        undefined
      );
      expect(got).to.deep.equal(events.map((event) => ({ ...event, metadata: { foo: 'bar' } })));
    });

    it('should intercept after non-streaming sendMessage for sendMessageStream', async () => {
      const params: MessageSendParams = {
        message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
      };
      const message: Message = {
        kind: 'message',
        messageId: '2',
        role: 'agent',
        parts: [],
      };
      transport.sendMessage.mockResolvedValue(message);
      const config: ClientConfig = {
        interceptors: [
          {
            before: async () => {},
            after: async (args) => {
              if (args.result.method === 'sendMessageStream') {
                args.result.value = { ...args.result.value, metadata: { foo: 'bar' } };
              }
            },
          },
        ],
      };
      client = new Client(transport, { ...agentCard, capabilities: { streaming: false } }, config);

      const result = client.sendMessageStream(params);

      const got = [];
      for await (const event of result) {
        got.push(event);
      }
      expect(got).to.deep.equal([{ ...message, metadata: { foo: 'bar' } }]);
    });

    const iteratorsTests = [
      {
        name: 'sendMessageStream',
        transportStubGetter: (t: Record<keyof Transport, Mock>): Mock => t.sendMessageStream,
        caller: (c: Client): AsyncGenerator<A2AStreamEventData> =>
          c.sendMessageStream({
            message: { kind: 'message', messageId: '1', role: 'user', parts: [] },
          }),
      },
      {
        name: 'resubscribeTask',
        transportStubGetter: (t: Record<keyof Transport, Mock>): Mock => t.resubscribeTask,
        caller: (c: Client): AsyncGenerator<A2AStreamEventData> => c.resubscribeTask({ id: '123' }),
      },
    ];

    iteratorsTests.forEach((test) => {
      describe(test.name, () => {
        it('should return early from iterator (before)', async () => {
          const events: A2AStreamEventData[] = [
            {
              kind: 'status-update',
              taskId: '123',
              contextId: 'ctx1',
              final: false,
              status: { state: 'working' },
            },
            {
              kind: 'status-update',
              taskId: '123',
              contextId: 'ctx1',
              final: false,
              status: { state: 'completed' },
            },
          ];
          async function* stream() {
            yield* events;
          }
          const transportStub = test.transportStubGetter(transport);
          transportStub.mockReturnValue(stream());
          let firstAfterCalled = false;
          let secondAfterCalled = false;
          let thirdAfterCalled = false;
          const config: ClientConfig = {
            interceptors: [
              {
                before: async () => {},
                after: async () => {
                  firstAfterCalled = true;
                },
              },
              {
                before: async (args) => {
                  if (args.input.method === test.name) {
                    args.earlyReturn = {
                      method: args.input.method,
                      value: events[0],
                    } as ClientCallResult;
                  }
                },
                after: async () => {
                  secondAfterCalled = true;
                },
              },
              {
                before: async () => {},
                after: async () => {
                  thirdAfterCalled = true;
                },
              },
            ],
          };
          client = new Client(transport, agentCard, config);

          const result = test.caller(client);

          const got = [];
          for await (const event of result) {
            got.push(event);
          }
          expect(transportStub).not.toHaveBeenCalled();
          expect(got).to.deep.equal([events[0]]);
          expect(firstAfterCalled).to.be.true;
          expect(secondAfterCalled).to.be.true;
          expect(thirdAfterCalled).to.be.false;
        });

        it('should return early from iterator (after)', async () => {
          const events: A2AStreamEventData[] = [
            {
              kind: 'status-update',
              taskId: '123',
              contextId: 'ctx1',
              final: false,
              status: { state: 'working' },
            },
            {
              kind: 'status-update',
              taskId: '123',
              contextId: 'ctx1',
              final: false,
              status: { state: 'completed' },
            },
          ];
          async function* stream() {
            yield* events;
          }
          const transportStub = test.transportStubGetter(transport);
          transportStub.mockReturnValue(stream());
          const config: ClientConfig = {
            interceptors: [
              {
                before: async () => {},
                after: async (args) => {
                  if (args.result.method === test.name) {
                    const event = args.result.value as A2AStreamEventData;
                    if (event.kind === 'status-update' && event.status.state === 'working') {
                      args.earlyReturn = true;
                    }
                  }
                },
              },
            ],
          };
          client = new Client(transport, agentCard, config);

          const result = test.caller(client);

          const got = [];
          for await (const event of result) {
            got.push(event);
          }
          expect(transportStub).toHaveBeenCalledTimes(1);
          expect(got).to.deep.equal([events[0]]);
        });
      });
    });
  });
});

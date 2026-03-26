import { describe, it, beforeEach, expect, vi, Mock } from 'vitest';
import { Client, ClientConfig, RequestOptions } from '../../src/client/multitransport-client.js';
import { Transport } from '../../src/client/transports/transport.js';
import {
  TaskPushNotificationConfig,
  Task,
  Message,
  TaskStatusUpdateEvent,
  AgentCard,
  Role,
  TaskState,
  A2AStreamEventData,
} from '../../src/index.js';
import {
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  SendMessageRequest,
  SubscribeToTaskRequest,
} from '../../src/types/pb/a2a.js';
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
      listTaskPushNotificationConfigs: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      subscribeToTask: vi.fn(),
    };
    agentCard = {
      protocolVersion: '0.3.0',
      name: 'Test Agent',
      description: 'Test Description',
      url: 'http://test-agent.com',
      version: '1.0.0',
      capabilities: {
        extensions: [],
        streaming: true,
        pushNotifications: true,
      },
      defaultInputModes: [],
      defaultOutputModes: [],
      skills: [],
      documentationUrl: 'http://test-agent.com/docs',
      security: [],
      securitySchemes: {},
      signatures: [],
      preferredTransport: 'json-rpc',
      additionalInterfaces: [],
      provider: { url: '', organization: '' },
      supportsAuthenticatedExtendedCard: false,
    };
    client = new Client(transport, agentCard);
  });

  it('should call transport.getAuthenticatedExtendedAgentCard', async () => {
    const agentCardWithExtendedSupport = { ...agentCard, supportsAuthenticatedExtendedCard: true };
    const extendedAgentCard: AgentCard = {
      ...agentCard,
      capabilities: { ...agentCard.capabilities, extensions: [] },
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
    const result = await client.getExtendedAgentCard(expectedOptions);

    expect(transport.getExtendedAgentCard).toHaveBeenCalledTimes(1);
    expect(result).to.equal(extendedAgentCard);
    expect(caughtOptions).to.equal(expectedOptions);
  });

  it('should not call transport.getAuthenticatedExtendedAgentCard if not supported', async () => {
    const result = await client.getExtendedAgentCard();

    expect(transport.getExtendedAgentCard).not.toHaveBeenCalled();
    expect(result).to.equal(agentCard);
  });

  it('should call transport.sendMessage with default returnImmediately=false', async () => {
    const params: SendMessageRequest = {
      tenant: '',
      message: {
        contextId: '123',
        messageId: 'msg1',
        role: Role.ROLE_USER,
        content: [{ part: { $case: 'text', value: 'hello' } }],
        taskId: '',
        extensions: [],
        metadata: {},
      },
      configuration: undefined,
      metadata: {},
    };
    const response: Message = {
      messageId: 'abc',
      role: Role.ROLE_AGENT,
      content: [{ part: { $case: 'text', value: 'response' } }],
      taskId: '',
      contextId: '123',
      extensions: [],
      metadata: {},
    };
    transport.sendMessage.mockResolvedValue(response);

    const result = await client.sendMessage(params);

    const expectedParams = {
      ...params,
      configuration: {
        ...params.configuration,
        returnImmediately: false,
        historyLength: 0,
        acceptedOutputModes: [] as string[],
      },
    };
    expect(transport.sendMessage.mock.contexts[0]).toBe(transport);
    expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    expect(result).to.deep.equal(response);
  });

  it('should call transport.sendMessageStream with returnImmediately=false', async () => {
    const params: SendMessageRequest = {
      tenant: '',
      message: {
        messageId: '1',
        role: Role.ROLE_USER,
        content: [],
        contextId: '',
        taskId: '',
        extensions: [],
        metadata: {},
      },
      configuration: undefined,
      metadata: {},
    };
    const events: A2AStreamEventData[] = [
      {
        taskId: '123',
        contextId: 'ctx1',
        final: false,
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
        metadata: {},
      },
      {
        taskId: '123',
        contextId: 'ctx1',
        final: false,
        status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: undefined, update: undefined },
        metadata: {},
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
      configuration: {
        ...params.configuration,
        returnImmediately: false,
        historyLength: 0,
        acceptedOutputModes: [] as string[],
      },
    };
    expect(transport.sendMessageStream).toHaveBeenCalledTimes(1);
    expect(transport.sendMessageStream).toHaveBeenCalledWith(expectedParams, undefined);
    expect(got).to.deep.equal(events);
  });

  it('should call transport.setTaskPushNotificationConfig', async () => {
    const params: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '123',
      id: 'abc',
      url: 'http://example.com',
      token: 'tok',
      authentication: undefined,
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
    const params: GetTaskPushNotificationConfigRequest = {
      taskId: '123',
      id: 'abc',
      tenant: '',
    };
    const config: TaskPushNotificationConfig = {
      taskId: '123',
      id: 'abc',
      url: 'http://example.com',
      token: 'tok',
      authentication: undefined,
      tenant: '',
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

  it('should call transport.listTaskPushNotificationConfigs', async () => {
    const params: ListTaskPushNotificationConfigsRequest = {
      taskId: '123',
      pageSize: 0,
      pageToken: '',
    };
    const configs: TaskPushNotificationConfig[] = [
      {
        taskId: '123',
        id: 'abc',
        url: 'http://example.com',
        token: 'tok',
        authentication: undefined,
        tenant: '',
      },
    ];
    transport.listTaskPushNotificationConfigs.mockResolvedValue(configs);

    const result = await client.listTaskPushNotificationConfigs(params);

    expect(transport.listTaskPushNotificationConfigs).toHaveBeenCalledExactlyOnceWith(
      params,
      undefined
    );
    expect(result).to.equal(configs);
  });

  it('should call transport.deleteTaskPushNotificationConfig', async () => {
    const params: DeleteTaskPushNotificationConfigRequest = {
      taskId: '123',
      id: 'abc',
      tenant: '',
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
    const params: GetTaskRequest = { id: '123', tenant: '', historyLength: 0 };
    const task: Task = {
      id: '123',
      contextId: 'ctx1',
      status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
      artifacts: [],
      history: [],
      metadata: {},
    };
    transport.getTask.mockResolvedValue(task);

    const result = await client.getTask(params);

    expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, undefined);
    expect(result).to.equal(task);
  });

  it('should call transport.cancelTask', async () => {
    const params: CancelTaskRequest = { id: '123', tenant: '' };
    const task: Task = {
      id: '123',
      contextId: 'ctx1',
      status: { state: TaskState.TASK_STATE_CANCELED, timestamp: undefined, update: undefined },
      artifacts: [],
      history: [],
      metadata: {},
    };
    transport.cancelTask.mockResolvedValue(task);

    const result = await client.cancelTask(params);

    expect(transport.cancelTask.mock.contexts[0]).toBe(transport);
    expect(transport.cancelTask).toHaveBeenCalledExactlyOnceWith(params, undefined);
    expect(result).to.equal(task);
  });

  it('should call transport.subscribeToTask', async () => {
    const params: SubscribeToTaskRequest = { taskId: '123', tenant: '' };
    const events: TaskStatusUpdateEvent[] = [
      {
        taskId: '123',
        contextId: 'ctx1',
        final: false,
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
        metadata: {},
      },
      {
        taskId: '123',
        contextId: 'ctx1',
        final: true,
        status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: undefined, update: undefined },
        metadata: {},
      },
    ];
    async function* stream() {
      yield* events;
    }
    transport.subscribeToTask.mockReturnValue(stream());

    const result = client.subscribeToTask(params);

    const got = [];
    for await (const event of result) {
      got.push(event);
    }
    expect(transport.subscribeToTask.mock.contexts[0]).toBe(transport);
    expect(transport.subscribeToTask).toHaveBeenCalledExactlyOnceWith(params, undefined);
    expect(got).to.deep.equal(events);
  });

  describe('sendMessage', () => {
    it('should set returnImmediately=true when polling is enabled', async () => {
      const config: ClientConfig = { polling: true };
      client = new Client(transport, agentCard, config);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          content: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
        },
        configuration: undefined,
        metadata: {},
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: { returnImmediately: true, historyLength: 0, acceptedOutputModes: [] as string[] },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });

    it('should set returnImmediately=true when explicitly provided in request', async () => {
      client = new Client(transport, agentCard);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          content: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
        },
        configuration: {
          returnImmediately: true,
          historyLength: 0,
          acceptedOutputModes: [] as string[],
          taskPushNotificationConfig: undefined,
        },
        metadata: {},
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: {
          returnImmediately: true,
          historyLength: 0,
          acceptedOutputModes: [] as string[],
          taskPushNotificationConfig: undefined,
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });

    it('should apply acceptedOutputModes', async () => {
      const config: ClientConfig = { polling: false, acceptedOutputModes: ['application/json'] };
      client = new Client(transport, agentCard, config);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          content: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
        },
        configuration: undefined,
        metadata: {},
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: {
          returnImmediately: false,
          historyLength: 0,
          acceptedOutputModes: ['application/json'],
          taskPushNotificationConfig: undefined,
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });

    it('should use acceptedOutputModes from request when provided', async () => {
      const config: ClientConfig = { polling: false, acceptedOutputModes: ['application/json'] };
      client = new Client(transport, agentCard, config);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          content: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
        },
        configuration: {
          acceptedOutputModes: ['text/plain'],
          returnImmediately: true,
          historyLength: 0,
          taskPushNotificationConfig: undefined,
        },
        metadata: {},
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: {
          returnImmediately: true,
          historyLength: 0,
          acceptedOutputModes: ['text/plain'],
          taskPushNotificationConfig: undefined,
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });

    it('should apply pushNotificationConfig', async () => {
      const pushConfig = {
        url: 'http://test.com',
        id: '1',
        token: 't',
        authentication: undefined,
      };
      const config: ClientConfig = { polling: false, pushNotificationConfig: pushConfig as any };
      client = new Client(transport, agentCard, config);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          content: [],
          contextId: '',
          taskId: '123', // required for push config mapping
          extensions: [],
          metadata: {},
        },
        configuration: undefined,
        metadata: {},
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: {
          returnImmediately: false,
          historyLength: 0,
          acceptedOutputModes: [] as string[],
          taskPushNotificationConfig: { ...pushConfig, taskId: '123' },
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });

    it('should use pushNotificationConfig from request when provided', async () => {
      const config: ClientConfig = {
        polling: false,
        pushNotificationConfig: {
          url: 'http://test.com',
          id: '1',
          token: 't',
          authentication: undefined,
        },
      };
      client = new Client(transport, agentCard, config);
      const pushConfig = {
        url: 'http://test2.com',
        id: '2',
        token: 't',
        authentication: undefined as any,
        taskId: '123',
        tenant: '',
      };
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          content: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
        },
        configuration: {
          taskPushNotificationConfig: pushConfig,
          returnImmediately: true,
          historyLength: 0,
          acceptedOutputModes: [] as string[],
        },
        metadata: {},
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: {
          returnImmediately: true,
          historyLength: 0,
          acceptedOutputModes: [] as string[],
          taskPushNotificationConfig: pushConfig,
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(expectedParams, undefined);
    });
  });

  describe('sendMessageStream', () => {
    it('should fallback to sendMessage if streaming is not supported', async () => {
      agentCard.capabilities.streaming = false;
      client = new Client(transport, agentCard);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          content: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
        },
        configuration: undefined,
        metadata: {},
      };
      const response: Message = {
        messageId: '2',
        role: Role.ROLE_AGENT,
        content: [],
        contextId: '',
        taskId: '',
        extensions: [],
        metadata: {},
      };
      transport.sendMessage.mockResolvedValue(response);

      const result = client.sendMessageStream(params);
      const yielded = await result.next();

      const expectedParams = {
        ...params,
        configuration: {
          returnImmediately: false,
          historyLength: 0,
          acceptedOutputModes: [] as string[],
          taskPushNotificationConfig: undefined as any,
        },
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
                args.input.value = { ...args.input.value, historyLength: 99 };
              }
            },
            after: async () => {},
          },
        ],
      };
      client = new Client(transport, agentCard, config);
      const params: GetTaskRequest = { id: '123', tenant: '', historyLength: 0 };
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(
        { id: '123', tenant: '', historyLength: 99 },
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
      const params: GetTaskRequest = { id: '123', tenant: '', historyLength: 0 };
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
        artifacts: [],
        history: [],
        metadata: {},
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
      const params: GetTaskRequest = { id: '123', tenant: '', historyLength: 0 };
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
        artifacts: [],
        history: [],
        metadata: {},
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
      const params: GetTaskRequest = { id: '123', tenant: '', historyLength: 0 };
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      };
      transport.getTask.mockResolvedValue(task);

      await client.getTask(params);
      expect(caughtAgentCard).to.equal(agentCard);
    });

    it('should return early from before', async () => {
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
        artifacts: [],
        history: [],
        metadata: {},
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
                args.input.value = { ...args.input.value };
              }
            },
            after: async () => {},
          },
        ],
      };
      client = new Client(transport, agentCard, config);
      const params: GetTaskRequest = { id: '123', tenant: '', historyLength: 0 };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).not.toHaveBeenCalled();
      expect(result).to.equal(task);
    });

    it('should return early from after', async () => {
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
        artifacts: [],
        history: [],
        metadata: {},
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
      const params: GetTaskRequest = { id: '123', tenant: '', historyLength: 0 };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, undefined);
      expect(result).to.equal(task);
    });

    it('should run after for interceptors executed in before for early return', async () => {
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
        artifacts: [],
        history: [],
        metadata: {},
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
      const params: GetTaskRequest = { id: '123', tenant: '', historyLength: 0 };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).not.toHaveBeenCalled();
      expect(firstAfterCalled).to.be.true;
      expect(secondAfterCalled).to.be.true;
      expect(thirdAfterCalled).to.be.false;
      expect(result).to.equal(task);
    });

    it('should intercept each iterator item', async () => {
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          content: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
        },
        configuration: undefined,
        metadata: {},
      };
      const events: A2AStreamEventData[] = [
        {
          taskId: '123',
          contextId: 'ctx1',
          final: false,
          status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, update: undefined },
          metadata: {},
        },
        {
          taskId: '123',
          contextId: 'ctx1',
          final: false,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            timestamp: undefined,
            update: undefined,
          },
          metadata: {},
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
        configuration: {
          ...params.configuration,
          returnImmediately: false,
          historyLength: 0,
          acceptedOutputModes: [] as string[],
        },
      };
      expect(transport.sendMessageStream).toHaveBeenCalledExactlyOnceWith(
        expectedParams,
        undefined
      );
      expect(got).to.deep.equal(events.map((event) => ({ ...event, metadata: { foo: 'bar' } })));
    });

    it('should intercept after non-streaming sendMessage for sendMessageStream', async () => {
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          content: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
        },
        configuration: undefined,
        metadata: {},
      };
      const responseMock: Message = {
        messageId: '2',
        role: Role.ROLE_AGENT,
        content: [],
        contextId: '',
        taskId: '',
        extensions: [],
        metadata: {},
      };
      transport.sendMessage.mockResolvedValue(responseMock);
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
      client = new Client(
        transport,
        { ...agentCard, capabilities: { ...agentCard.capabilities, streaming: false } },
        config
      );

      const result = client.sendMessageStream(params);

      const got = [];
      for await (const event of result) {
        got.push(event);
      }
      expect(got).to.deep.equal([{ ...responseMock, metadata: { foo: 'bar' } }]);
    });

    const iteratorsTests = [
      {
        name: 'sendMessageStream',
        transportStubGetter: (t: Record<keyof Transport, Mock>): Mock => t.sendMessageStream,
        caller: (c: Client): AsyncGenerator<A2AStreamEventData> =>
          c.sendMessageStream({
            tenant: '',
            message: {
              messageId: '1',
              role: Role.ROLE_USER,
              content: [],
              contextId: '',
              taskId: '',
              extensions: [],
              metadata: {},
            },
            configuration: undefined,
            metadata: {},
          }),
      },
      {
        name: 'subscribeToTask',
        transportStubGetter: (t: Record<keyof Transport, Mock>): Mock => t.subscribeToTask,
        caller: (c: Client): AsyncGenerator<A2AStreamEventData> =>
          c.subscribeToTask({ taskId: '123', tenant: '' }),
      },
    ];

    iteratorsTests.forEach((test) => {
      describe(test.name, () => {
        it('should return early from iterator (before)', async () => {
          const events: A2AStreamEventData[] = [
            {
              taskId: '123',
              contextId: 'ctx1',
              final: false,
              status: {
                state: TaskState.TASK_STATE_WORKING,
                timestamp: undefined,
                update: undefined,
              },
              metadata: {},
            },
            {
              taskId: '123',
              contextId: 'ctx1',
              final: false,
              status: {
                state: TaskState.TASK_STATE_COMPLETED,
                timestamp: undefined,
                update: undefined,
              },
              metadata: {},
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
              taskId: '123',
              contextId: 'ctx1',
              final: false,
              status: {
                state: TaskState.TASK_STATE_WORKING,
                timestamp: undefined,
                update: undefined,
              },
              metadata: {},
            },
            {
              taskId: '123',
              contextId: 'ctx1',
              final: false,
              status: {
                state: TaskState.TASK_STATE_COMPLETED,
                timestamp: undefined,
                update: undefined,
              },
              metadata: {},
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
                    if ('status' in event && event.status?.state === TaskState.TASK_STATE_WORKING) {
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

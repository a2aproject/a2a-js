import { describe, it, beforeEach, expect, vi, Mock } from 'vitest';
import { Client, ClientConfig, RequestOptions } from '../../src/client/multitransport-client.js';
import { Transport } from '../../src/client/transports/transport.js';
import {
  TaskPushNotificationConfig,
  Task,
  Message,
  AgentCard,
  Role,
  TaskState,
  StreamResponse,
  A2A_VERSION_HEADER,
  A2A_PROTOCOL_VERSION,
} from '../../src/index.js';

/**
 * Helper: the default RequestOptions that the Client injects when the caller
 * passes no explicit options. Contains the auto-injected A2A-Version header.
 */
const defaultVersionOptions: RequestOptions = {
  serviceParameters: { [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION },
};
import {
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  SendMessageRequest,
  SubscribeToTaskRequest,
  ListTasksRequest,
  ListTasksResponse,
} from '../../src/types/pb/a2a.js';
import { ClientCallResult } from '../../src/client/interceptors.js';

describe('Client', () => {
  let transport: Record<Exclude<keyof Transport, 'protocolName' | 'protocolVersion'>, Mock> & {
    protocolName: string;
    protocolVersion: string;
  };
  let client: Client;
  let agentCard: AgentCard;

  beforeEach(() => {
    transport = {
      getExtendedAgentCard: vi.fn(),
      sendMessage: vi.fn(),
      sendMessageStream: vi.fn(),
      createTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfig: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      listTasks: vi.fn(),
      resubscribeTask: vi.fn(),
      protocolName: 'MockTransport',
      protocolVersion: '1.0',
    };
    agentCard = {
      name: 'Test Agent',
      description: 'Test Description',
      version: '1.0.0',
      capabilities: {
        extensions: [],
        streaming: true,
        pushNotifications: true,
        extendedAgentCard: false,
      },
      defaultInputModes: [],
      defaultOutputModes: [],
      skills: [],
      documentationUrl: 'http://test-agent.com/docs',
      securityRequirements: [],
      signatures: [],
      provider: { url: '', organization: '' },
      supportedInterfaces: [],
      securitySchemes: {},
    };
    client = new Client(transport, agentCard);
  });

  it('should call transport.getAuthenticatedExtendedAgentCard', async () => {
    const agentCardWithExtendedSupport = {
      ...agentCard,
      capabilities: { ...agentCard.capabilities, extendedAgentCard: true },
    };
    const extendedAgentCard: AgentCard = {
      ...agentCard,
      capabilities: { ...agentCard.capabilities, extensions: [] },
    };
    client = new Client(transport, agentCardWithExtendedSupport);

    let caughtParams: unknown;
    let caughtOptions: unknown;
    transport.getExtendedAgentCard.mockImplementation(async (params, options) => {
      caughtParams = params;
      caughtOptions = options;
      return extendedAgentCard;
    });

    const expectedOptions: RequestOptions = {
      serviceParameters: { key: 'value' },
    };
    const result = await client.getAgentCard(expectedOptions);

    expect(transport.getExtendedAgentCard).toHaveBeenCalledTimes(1);
    expect(result).to.equal(extendedAgentCard);
    expect(caughtParams).to.deep.equal({ tenant: '' });
    expect(caughtOptions).toEqual({
      serviceParameters: { [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION, key: 'value' },
    });
  });

  it('should not call transport.getAuthenticatedExtendedAgentCard if not supported', async () => {
    const result = await client.getAgentCard();

    expect(transport.getExtendedAgentCard).not.toHaveBeenCalled();
    expect(result).to.equal(agentCard);
  });

  it('should call transport.sendMessage with default returnImmediately=false', async () => {
    const params: SendMessageRequest = {
      message: {
        contextId: '123',
        messageId: 'msg1',
        role: Role.ROLE_USER,
        parts: [
          {
            content: { $case: 'text', value: 'hello' },
            mediaType: 'text/plain',
            filename: '',
            metadata: {},
          },
        ],
        taskId: '',
        extensions: [],
        metadata: {},
        referenceTaskIds: [],
      },
      tenant: '',
      configuration: undefined,
      metadata: {},
    };
    const response: Message = {
      messageId: 'abc',
      role: Role.ROLE_AGENT,
      parts: [
        {
          content: { $case: 'text', value: 'response' },
          mediaType: 'text/plain',
          filename: '',
          metadata: {},
        },
      ],
      taskId: '',
      contextId: '123',
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
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
    expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expectedParams,
      defaultVersionOptions
    );
    expect(result).to.deep.equal(response);
  });

  it('should call transport.sendMessageStream with returnImmediately=false', async () => {
    const params: SendMessageRequest = {
      tenant: '',
      message: {
        messageId: '1',
        role: Role.ROLE_USER,
        parts: [],
        contextId: '',
        taskId: '',
        extensions: [],
        metadata: {},
        referenceTaskIds: [],
      },
      configuration: undefined,
      metadata: {},
    };
    const events: StreamResponse[] = [
      {
        payload: {
          $case: 'task',
          value: {
            id: '123',
            contextId: 'ctx1',
            status: {
              state: TaskState.TASK_STATE_WORKING,
              timestamp: undefined,
              message: undefined,
            },
            metadata: {},
            artifacts: [],
            history: [],
          },
        },
      },
      {
        payload: {
          $case: 'task',
          value: {
            id: '123',
            contextId: 'ctx1',
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              timestamp: undefined,
              message: undefined,
            },
            metadata: {},
            artifacts: [],
            history: [],
          },
        },
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
    expect(transport.sendMessageStream).toHaveBeenCalledWith(expectedParams, defaultVersionOptions);
    expect(got).to.deep.equal(events);
  });

  it('should call transport.createTaskPushNotificationConfig', async () => {
    const config: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '',
      id: 'abc',
      url: 'http://example.com',
      token: 'tok',
      authentication: undefined,
    };
    transport.createTaskPushNotificationConfig.mockResolvedValue(config);

    const result = await client.createTaskPushNotificationConfig(config);

    expect(transport.createTaskPushNotificationConfig.mock.contexts[0]).toBe(transport);
    expect(transport.createTaskPushNotificationConfig).toHaveBeenCalledExactlyOnceWith(
      config,
      defaultVersionOptions
    );
    expect(result).to.equal(config);
  });

  it('should call transport.getTaskPushNotificationConfig', async () => {
    const params: GetTaskPushNotificationConfigRequest = {
      tenant: '',
      taskId: '123',
      id: 'abc',
    };
    const config: TaskPushNotificationConfig = {
      tenant: '',
      taskId: '123',
      id: 'abc',
      url: 'http://example.com',
      token: 'tok',
      authentication: undefined,
    };
    transport.getTaskPushNotificationConfig.mockResolvedValue(config);

    const result = await client.getTaskPushNotificationConfig(params);

    expect(transport.getTaskPushNotificationConfig.mock.contexts[0]).toBe(transport);
    expect(transport.getTaskPushNotificationConfig).toHaveBeenCalledExactlyOnceWith(
      params,
      defaultVersionOptions
    );
    expect(result).to.equal(config);
  });

  it('should call transport.listTaskPushNotificationConfig', async () => {
    const params: ListTaskPushNotificationConfigsRequest = {
      tenant: '',
      taskId: '123',
      pageSize: 0,
      pageToken: '',
    };
    const configs: TaskPushNotificationConfig[] = [
      {
        tenant: '',
        taskId: '123',
        id: 'abc',
        url: 'http://example.com',
        token: 'tok',
        authentication: undefined,
      },
    ];
    transport.listTaskPushNotificationConfig.mockResolvedValue(configs);

    const result = await client.listTaskPushNotificationConfig(params);

    expect(transport.listTaskPushNotificationConfig).toHaveBeenCalledExactlyOnceWith(
      params,
      defaultVersionOptions
    );
    expect(result).to.equal(configs);
  });

  it('should call transport.deleteTaskPushNotificationConfig', async () => {
    const params: DeleteTaskPushNotificationConfigRequest = {
      tenant: '',
      taskId: '123',
      id: 'abc',
    };
    transport.deleteTaskPushNotificationConfig.mockResolvedValue(undefined);

    await client.deleteTaskPushNotificationConfig(params);

    expect(transport.deleteTaskPushNotificationConfig.mock.contexts[0]).toBe(transport);
    expect(transport.deleteTaskPushNotificationConfig).toHaveBeenCalledExactlyOnceWith(
      params,
      defaultVersionOptions
    );
  });

  it('should call transport.getTask', async () => {
    const params: GetTaskRequest = { tenant: '', id: '123', historyLength: 0 };
    const task: Task = {
      id: '123',
      contextId: 'ctx1',
      status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, message: undefined },
      artifacts: [],
      history: [],
      metadata: {},
    };
    transport.getTask.mockResolvedValue(task);

    const result = await client.getTask(params);

    expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, defaultVersionOptions);
    expect(result).to.equal(task);
  });

  it('should call transport.cancelTask', async () => {
    const params: CancelTaskRequest = { tenant: '', id: '123', metadata: {} };
    const task: Task = {
      id: '123',
      contextId: 'ctx1',
      status: { state: TaskState.TASK_STATE_CANCELED, timestamp: undefined, message: undefined },
      artifacts: [],
      history: [],
      metadata: {},
    };
    transport.cancelTask.mockResolvedValue(task);

    const result = await client.cancelTask(params);

    expect(transport.cancelTask.mock.contexts[0]).toBe(transport);
    expect(transport.cancelTask).toHaveBeenCalledExactlyOnceWith(params, defaultVersionOptions);
    expect(result).to.equal(task);
  });

  it('should call transport.listTasks', async () => {
    const params: ListTasksRequest = {
      tenant: '',
      contextId: 'ctx1',
      status: TaskState.TASK_STATE_WORKING,
      pageToken: '',
      statusTimestampAfter: undefined,
    };
    const response: ListTasksResponse = {
      tasks: [
        {
          id: '123',
          contextId: 'ctx1',
          status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, message: undefined },
          artifacts: [],
          history: [],
          metadata: {},
        },
      ],
      nextPageToken: '',
      pageSize: 1,
      totalSize: 1,
    };
    transport.listTasks.mockResolvedValue(response);

    const result = await client.listTasks(params);

    expect(transport.listTasks).toHaveBeenCalledExactlyOnceWith(params, defaultVersionOptions);
    expect(result).to.equal(response);
  });

  it('should call transport.resubscribeTask', async () => {
    const params: SubscribeToTaskRequest = { tenant: '', id: '123' };
    const events: StreamResponse[] = [
      {
        payload: {
          $case: 'task',
          value: {
            id: '123',
            contextId: 'ctx1',
            status: {
              state: TaskState.TASK_STATE_WORKING,
              timestamp: undefined,
              message: undefined,
            },
            metadata: {},
            artifacts: [],
            history: [],
          },
        },
      },
      {
        payload: {
          $case: 'task',
          value: {
            id: '123',
            contextId: 'ctx1',
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              timestamp: undefined,
              message: undefined,
            },
            metadata: {},
            artifacts: [],
            history: [],
          },
        },
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
    expect(transport.resubscribeTask).toHaveBeenCalledExactlyOnceWith(
      params,
      defaultVersionOptions
    );
    expect(got).to.deep.equal(events);
  });

  describe('sendMessage', () => {
    it('should set blocking=false when polling is enabled', async () => {
      const config: ClientConfig = { polling: true };
      client = new Client(transport, agentCard, config);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          parts: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
        },
        configuration: undefined,
        metadata: {},
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: {
          returnImmediately: true,
          historyLength: 0,
          acceptedOutputModes: [] as string[],
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expectedParams,
        defaultVersionOptions
      );
    });

    it('should set blocking=false when explicitly provided in request', async () => {
      client = new Client(transport, agentCard);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          parts: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
        },
        configuration: {
          returnImmediately: true,
          historyLength: 0,
          acceptedOutputModes: [] as string[],
          taskPushNotificationConfig: undefined as TaskPushNotificationConfig,
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
          taskPushNotificationConfig: undefined as TaskPushNotificationConfig,
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expectedParams,
        defaultVersionOptions
      );
    });

    it('should apply acceptedOutputModes', async () => {
      const config: ClientConfig = { polling: false, acceptedOutputModes: ['application/json'] };
      client = new Client(transport, agentCard, config);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          parts: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
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
          taskPushNotificationConfig: undefined as TaskPushNotificationConfig,
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expectedParams,
        defaultVersionOptions
      );
    });

    it('should use acceptedOutputModes from request when provided', async () => {
      const config: ClientConfig = { polling: false, acceptedOutputModes: ['application/json'] };
      client = new Client(transport, agentCard, config);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          parts: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
        },
        configuration: {
          acceptedOutputModes: ['text/plain'],
          returnImmediately: true,
          historyLength: 0,
          taskPushNotificationConfig: undefined as TaskPushNotificationConfig,
        },
        metadata: {},
      };

      await client.sendMessage(params);

      const expectedParams = {
        ...params,
        configuration: {
          acceptedOutputModes: ['text/plain'],
          returnImmediately: true,
          historyLength: 0,
          taskPushNotificationConfig: undefined as TaskPushNotificationConfig,
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expectedParams,
        defaultVersionOptions
      );
    });

    it('should apply pushNotificationConfig', async () => {
      const pushConfig: TaskPushNotificationConfig = {
        tenant: '',
        taskId: '',
        id: '1',
        url: 'http://test.com',
        token: 't',
        authentication: undefined as any,
      };
      const config: ClientConfig = { polling: false, pushNotificationConfig: pushConfig as any };
      client = new Client(transport, agentCard, config);
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          parts: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
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
          taskPushNotificationConfig: pushConfig,
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expectedParams,
        defaultVersionOptions
      );
    });

    it('should use pushNotificationConfig from request when provided', async () => {
      const config: ClientConfig = {
        polling: false,
        pushNotificationConfig: {
          tenant: '',
          taskId: '',
          id: '1',
          url: 'http://test.com',
          token: 't',
          authentication: undefined,
        },
      };
      client = new Client(transport, agentCard, config);
      const pushConfig: TaskPushNotificationConfig = {
        tenant: '',
        taskId: '',
        id: '2',
        url: 'http://test2.com',
        token: 't',
        authentication: undefined,
      };
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          parts: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
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
          taskPushNotificationConfig: pushConfig,
          returnImmediately: true,
          historyLength: 0,
          acceptedOutputModes: [] as string[],
        },
      };
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expectedParams,
        defaultVersionOptions
      );
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
          parts: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
        },
        configuration: undefined,
        metadata: {},
      };
      const response: Message = {
        messageId: '2',
        role: Role.ROLE_AGENT,
        parts: [],
        contextId: '',
        taskId: '',
        extensions: [],
        metadata: {},
        referenceTaskIds: [],
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
      expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expectedParams,
        defaultVersionOptions
      );
      expect(yielded.value).to.deep.equal({
        payload: {
          $case: 'message',
          value: response,
        },
      });
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
      const params: GetTaskRequest = { tenant: '', id: '123', historyLength: 0 };
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, message: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(
        { tenant: '', id: '123', historyLength: 99 },
        defaultVersionOptions
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
      const params: GetTaskRequest = { tenant: '', id: '123', historyLength: 0 };
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, message: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, defaultVersionOptions);
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
      const params: GetTaskRequest = { tenant: '', id: '123', historyLength: 0 };
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, message: undefined },
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
      const params: GetTaskRequest = { tenant: '', id: '123', historyLength: 0 };
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, message: undefined },
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
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, message: undefined },
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
      const params: GetTaskRequest = { tenant: '', id: '123', historyLength: 0 };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).not.toHaveBeenCalled();
      expect(result).to.equal(task);
    });

    it('should return early from after', async () => {
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, message: undefined },
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
      const params: GetTaskRequest = { tenant: '', id: '123', historyLength: 0 };
      transport.getTask.mockResolvedValue(task);

      const result = await client.getTask(params);

      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, defaultVersionOptions);
      expect(result).to.equal(task);
    });

    it('should run after for interceptors executed in before for early return', async () => {
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: { state: TaskState.TASK_STATE_WORKING, timestamp: undefined, message: undefined },
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
      const params: GetTaskRequest = { tenant: '', id: '123', historyLength: 0 };
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
          parts: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
        },
        configuration: undefined,
        metadata: {},
      };
      const events: StreamResponse[] = [
        {
          payload: {
            $case: 'statusUpdate',
            value: {
              taskId: '123',
              contextId: 'ctx1',
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
              taskId: '123',
              contextId: 'ctx1',
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
                const val = args.result.value;
                if (val.payload?.$case === 'statusUpdate') {
                  val.payload.value.metadata = {
                    ...val.payload.value.metadata,
                    foo: 'bar',
                  };
                }
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
        defaultVersionOptions
      );
      expect(got).to.deep.equal(
        events.map((event) => {
          if (event.payload?.$case === 'statusUpdate') {
            return {
              ...event,
              payload: {
                ...event.payload,
                value: {
                  ...event.payload.value,
                  metadata: { foo: 'bar' },
                },
              },
            };
          }
          return event;
        })
      );
    });

    it('should intercept after non-streaming sendMessage for sendMessageStream', async () => {
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: '1',
          role: Role.ROLE_USER,
          parts: [],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
        },
        configuration: undefined,
        metadata: {},
      };
      const responseMock: Message = {
        messageId: '2',
        role: Role.ROLE_AGENT,
        parts: [],
        contextId: '',
        taskId: '',
        extensions: [],
        metadata: {},
        referenceTaskIds: [],
      };
      transport.sendMessage.mockResolvedValue(responseMock);
      const config: ClientConfig = {
        interceptors: [
          {
            before: async () => {},
            after: async (args) => {
              if (args.result.method === 'sendMessageStream') {
                const val = args.result.value;
                if (val.payload?.$case === 'message') {
                  val.payload.value.metadata = {
                    ...val.payload.value.metadata,
                    foo: 'bar',
                  };
                }
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
      expect(got).to.deep.equal([
        {
          payload: {
            $case: 'message',
            value: {
              ...responseMock,
              metadata: { foo: 'bar' },
            },
          },
        },
      ]);
    });

    const iteratorsTests = [
      {
        name: 'sendMessageStream',
        transportStubGetter: (t: typeof transport): Mock => t.sendMessageStream,
        caller: (c: Client): AsyncGenerator<StreamResponse> =>
          c.sendMessageStream({
            tenant: '',
            message: {
              messageId: '1',
              role: Role.ROLE_USER,
              parts: [],
              contextId: '',
              taskId: '',
              extensions: [],
              metadata: {},
              referenceTaskIds: [],
            },
            configuration: undefined,
            metadata: {},
          }),
      },
      {
        name: 'resubscribeTask',
        transportStubGetter: (t: typeof transport): Mock => t.resubscribeTask,
        caller: (c: Client): AsyncGenerator<StreamResponse> =>
          c.resubscribeTask({ tenant: '', id: '123' }),
      },
    ];

    iteratorsTests.forEach((test) => {
      describe(test.name, () => {
        it('should return early from iterator (before)', async () => {
          const events: StreamResponse[] = [
            {
              payload: {
                $case: 'statusUpdate',
                value: {
                  taskId: '123',
                  contextId: 'ctx1',
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
                  taskId: '123',
                  contextId: 'ctx1',
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
          const events: StreamResponse[] = [
            {
              payload: {
                $case: 'statusUpdate',
                value: {
                  taskId: '123',
                  contextId: 'ctx1',
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
                  taskId: '123',
                  contextId: 'ctx1',
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
                    const event = args.result.value as StreamResponse;
                    if (
                      event.payload?.$case === 'statusUpdate' &&
                      event.payload.value.status?.state === TaskState.TASK_STATE_WORKING
                    ) {
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

  describe('A2A-Version header', () => {
    it('should resolve protocolVersion from transport', () => {
      const client = new Client(transport, agentCard);
      expect(client.protocolVersion).toBe(transport.protocolVersion);
    });

    it('should inject A2A-Version into service parameters', async () => {
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: undefined,
          message: undefined,
        },
        artifacts: [],
        history: [],
        metadata: {},
      };
      transport.getTask.mockResolvedValue(task);

      const params = { tenant: '', id: '123', historyLength: 0 };
      await client.getTask(params);

      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, defaultVersionOptions);
    });

    it('should use transport version even when user provides A2A-Version', async () => {
      const task: Task = {
        id: '123',
        contextId: 'ctx1',
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: undefined,
          message: undefined,
        },
        artifacts: [],
        history: [],
        metadata: {},
      };
      transport.getTask.mockResolvedValue(task);

      const params = { tenant: '', id: '123', historyLength: 0 };
      const options: RequestOptions = {
        serviceParameters: { [A2A_VERSION_HEADER]: '0.3' },
      };
      await client.getTask(params, options);

      // The transport's protocolVersion always takes precedence
      expect(transport.getTask).toHaveBeenCalledExactlyOnceWith(params, defaultVersionOptions);
    });
  });
});

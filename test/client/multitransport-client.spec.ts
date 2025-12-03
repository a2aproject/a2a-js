import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { Client, ClientConfig } from '../../src/client/multitransport-client.js';
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

describe('Client', () => {
  let transport: sinon.SinonStubbedInstance<Transport>;
  let client: Client;
  let agentCard: AgentCard;

  beforeEach(() => {
    transport = {
      sendMessage: sinon.stub(),
      sendMessageStream: sinon.stub(),
      setTaskPushNotificationConfig: sinon.stub(),
      getTaskPushNotificationConfig: sinon.stub(),
      listTaskPushNotificationConfig: sinon.stub(),
      deleteTaskPushNotificationConfig: sinon.stub(),
      getTask: sinon.stub(),
      cancelTask: sinon.stub(),
      resubscribeTask: sinon.stub(),
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
    transport.sendMessage.resolves(response);

    const result = await client.sendMessage(params);

    const expectedParams = {
      ...params,
      configuration: { ...params.configuration, blocking: true },
    };
    expect(transport.sendMessage.calledOn(transport)).to.be.true;
    expect(transport.sendMessage.calledOnceWith(expectedParams)).to.be.true;
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
    transport.sendMessageStream.returns(stream());

    const result = client.sendMessageStream(params);

    const got = [];
    for await (const event of result) {
      got.push(event);
    }
    const expectedParams = {
      ...params,
      configuration: { ...params.configuration, blocking: true },
    };
    expect(transport.sendMessageStream.calledOn(transport)).to.be.true;
    expect(transport.sendMessageStream.calledOnceWith(expectedParams)).to.be.true;
    expect(got).to.deep.equal(events);
  });

  it('should call transport.setTaskPushNotificationConfig', async () => {
    const params: TaskPushNotificationConfig = {
      taskId: '123',
      pushNotificationConfig: { url: 'http://example.com' },
    };
    transport.setTaskPushNotificationConfig.resolves(params);

    const result = await client.setTaskPushNotificationConfig(params);

    expect(transport.setTaskPushNotificationConfig.calledOn(transport)).to.be.true;
    expect(transport.setTaskPushNotificationConfig.calledOnceWith(params)).to.be.true;
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
    transport.getTaskPushNotificationConfig.resolves(config);

    const result = await client.getTaskPushNotificationConfig(params);

    expect(transport.getTaskPushNotificationConfig.calledOn(transport)).to.be.true;
    expect(transport.getTaskPushNotificationConfig.calledOnceWith(params)).to.be.true;
    expect(result).to.equal(config);
  });

  it('should call transport.listTaskPushNotificationConfig', async () => {
    const params: ListTaskPushNotificationConfigParams = { id: '123' };
    const configs: TaskPushNotificationConfig[] = [
      { taskId: '123', pushNotificationConfig: { url: 'http://example.com' } },
    ];
    transport.listTaskPushNotificationConfig.resolves(configs);

    const result = await client.listTaskPushNotificationConfig(params);

    expect(transport.listTaskPushNotificationConfig.calledOnceWith(params)).to.be.true;
    expect(result).to.equal(configs);
  });

  it('should call transport.deleteTaskPushNotificationConfig', async () => {
    const params: DeleteTaskPushNotificationConfigParams = {
      id: '123',
      pushNotificationConfigId: 'abc',
    };
    transport.deleteTaskPushNotificationConfig.resolves();

    await client.deleteTaskPushNotificationConfig(params);

    expect(transport.deleteTaskPushNotificationConfig.calledOn(transport)).to.be.true;
    expect(transport.deleteTaskPushNotificationConfig.calledOnceWith(params)).to.be.true;
  });

  it('should call transport.getTask', async () => {
    const params: TaskQueryParams = { id: '123' };
    const task: Task = { id: '123', kind: 'task', contextId: 'ctx1', status: { state: 'working' } };
    transport.getTask.resolves(task);

    const result = await client.getTask(params);

    expect(transport.getTask.calledOnceWith(params)).to.be.true;
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
    transport.cancelTask.resolves(task);

    const result = await client.cancelTask(params);

    expect(transport.cancelTask.calledOn(transport)).to.be.true;
    expect(transport.cancelTask.calledOnceWith(params)).to.be.true;
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
    transport.resubscribeTask.returns(stream());

    const result = client.resubscribeTask(params);

    const got = [];
    for await (const event of result) {
      got.push(event);
    }
    expect(transport.resubscribeTask.calledOn(transport)).to.be.true;
    expect(transport.resubscribeTask.calledOnceWith(params)).to.be.true;
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
      expect(transport.sendMessage.calledOnceWith(expectedParams)).to.be.true;
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
      expect(transport.sendMessage.calledOnceWith(expectedParams)).to.be.true;
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
      expect(transport.sendMessage.calledOnceWith(expectedParams)).to.be.true;
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
      expect(transport.sendMessage.calledOnceWith(expectedParams)).to.be.true;
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
      expect(transport.sendMessage.calledOnceWith(expectedParams)).to.be.true;
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
      expect(transport.sendMessage.calledOnceWith(expectedParams)).to.be.true;
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
      transport.sendMessage.resolves(response);

      const result = client.sendMessageStream(params);
      const yielded = await result.next();

      const expectedParams = {
        ...params,
        configuration: { blocking: true },
      };
      expect(transport.sendMessage.calledOnceWith(expectedParams)).to.be.true;
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
      transport.getTask.resolves(task);

      const result = await client.getTask(params);

      expect(transport.getTask.calledOnceWith({ id: '123', metadata: { foo: 'bar' } })).to.be.true;
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
      transport.getTask.resolves(task);

      const result = await client.getTask(params);

      expect(transport.getTask.calledOnceWith(params)).to.be.true;
      expect(result).to.deep.equal({ ...task, metadata: { foo: 'bar' } });
    });

    it('should modify options', async () => {
      const config: ClientConfig = {
        interceptors: [
          {
            before: async (args) => {
              args.options = { context: new Map([['foo', 'bar']]) };
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
      transport.getTask.resolves(task);

      const result = await client.getTask(params);

      expect(transport.getTask.calledOnceWith(params, { context: new Map([['foo', 'bar']]) })).to.be
        .true;
      expect(result).to.equal(task);
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
      transport.getTask.resolves(task);

      const result = await client.getTask(params);

      expect(transport.getTask.notCalled).to.be.true;
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
              args.earlyReturn = true;
            },
          },
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
      transport.getTask.resolves(task);

      const result = await client.getTask(params);

      expect(transport.getTask.calledOnceWith(params)).to.be.true;
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
      transport.getTask.resolves(task);

      const result = await client.getTask(params);

      expect(transport.getTask.notCalled).to.be.true;
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
      transport.sendMessageStream.returns(stream());
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
      expect(transport.sendMessageStream.calledOnceWith(expectedParams)).to.be.true;
      expect(got).to.deep.equal(events.map((event) => ({ ...event, metadata: { foo: 'bar' } })));
    });

    it('should return early from iterator (before)', async () => {
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
      transport.sendMessageStream.returns(stream());
      const config: ClientConfig = {
        interceptors: [
          {
            before: async (args) => {
              if (args.input.method === 'sendMessageStream') {
                args.earlyReturn = {
                  method: 'sendMessageStream',
                  value: events[0],
                };
              }
            },
            after: async () => {},
          },
        ],
      };
      client = new Client(transport, agentCard, config);

      const result = client.sendMessageStream(params);

      const got = [];
      for await (const event of result) {
        got.push(event);
      }
      expect(transport.sendMessageStream.notCalled).to.be.true;
      expect(got).to.deep.equal([events[0]]);
    });

    it('should return early from iterator (after)', async () => {
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
      transport.sendMessageStream.returns(stream());
      const config: ClientConfig = {
        interceptors: [
          {
            before: async () => {},
            after: async (args) => {
              if (args.result.method === 'sendMessageStream') {
                if (
                  args.result.value.kind === 'status-update' &&
                  args.result.value.status.state === 'working'
                ) {
                  args.earlyReturn = true;
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
        configuration: { ...params.configuration, blocking: true },
      };
      expect(transport.sendMessageStream.calledOnceWith(expectedParams)).to.be.true;
      expect(got).to.deep.equal([events[0]]);
    });
  });
});

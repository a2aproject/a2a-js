import { describe, it, beforeEach, expect, vi, Mock } from 'vitest';
import { Client } from '../../src/client/multitransport-client.js';
import { Transport } from '../../src/client/transports/transport.js';
import type { CallInterceptor } from '../../src/client/interceptors.js';
import type { A2APlugin, ClientRequest, ClientResponse } from '../../src/plugins/index.js';
import {
  AgentCard,
  Message,
  Role,
  SendMessageRequest,
  StreamResponse,
  Task,
  TaskState,
} from '../../src/types/pb/a2a.js';

describe('Client plugin hooks', () => {
  let transport: Record<
    Exclude<keyof Transport, 'protocolName' | 'protocolVersion' | 'endpoint'>,
    Mock
  > & {
    protocolName: string;
    protocolVersion: string;
    endpoint?: string;
  };
  let agentCard: AgentCard;
  let calls: string[];
  let requests: ClientRequest[];
  let responses: ClientResponse[];

  const task: Task = {
    id: 't1',
    contextId: 'c1',
    status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
    artifacts: [],
    history: [],
    metadata: {},
  };

  const message: Message = {
    messageId: 'm1',
    role: Role.ROLE_USER,
    parts: [],
    contextId: '',
    taskId: '',
    metadata: {},
    extensions: [],
    referenceTaskIds: [],
  };

  function sendParams(): SendMessageRequest {
    return { tenant: '', message, configuration: undefined, metadata: {} };
  }

  async function* events(...items: StreamResponse[]): AsyncGenerator<StreamResponse> {
    yield* items;
  }

  /** Records every client hook call. */
  function recorder(name = 'recorder', overrides: Partial<A2APlugin> = {}): A2APlugin {
    return {
      name,
      beforeClientRequest: (req) => {
        calls.push(`${name}.before:${req.method}`);
        requests.push(req);
      },
      aroundClientRequest: (req, next) => {
        calls.push(`${name}.around:${req.method}`);
        return next();
      },
      afterClientRequest: (res) => {
        calls.push(`${name}.after:${res.isFinal ? 'final' : 'event'}`);
        responses.push(res);
      },
      ...overrides,
    };
  }

  function createClient(plugins: A2APlugin[], interceptors?: CallInterceptor[]): Client {
    return new Client(transport, agentCard, { plugins, interceptors });
  }

  beforeEach(() => {
    transport = {
      getExtendedAgentCard: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(task),
      sendMessageStream: vi.fn(),
      createTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfig: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      getTask: vi.fn().mockResolvedValue(task),
      cancelTask: vi.fn().mockResolvedValue(task),
      listTasks: vi.fn().mockResolvedValue({ tasks: [], nextPageToken: '' }),
      resubscribeTask: vi.fn(),
      protocolName: 'MockTransport',
      protocolVersion: '1.0',
    };
    agentCard = {
      name: 'Test Agent',
      description: '',
      version: '1.0.0',
      capabilities: {
        extensions: [],
        streaming: true,
        pushNotifications: true,
        extendedAgentCard: true,
      },
      defaultInputModes: [],
      defaultOutputModes: [],
      skills: [],
      documentationUrl: '',
      securityRequirements: [],
      signatures: [],
      provider: { url: '', organization: '' },
      supportedInterfaces: [],
      securitySchemes: {},
    };
    calls = [];
    requests = [];
    responses = [];
  });

  describe('unary calls', () => {
    it('runs before, around and after with the request and result', async () => {
      const client = createClient([recorder()]);
      const params = { id: 't1', tenant: '' };

      const result = await client.getTask(params);

      expect(result).toBe(task);
      expect(calls).toEqual([
        'recorder.before:GetTask',
        'recorder.around:GetTask',
        'recorder.after:final',
      ]);
      expect(requests[0]).toMatchObject({ method: 'GetTask', payload: params, agentCard });
      expect(responses[0]).toMatchObject({
        method: 'GetTask',
        payload: task,
        isStreamEvent: false,
        isFinal: true,
      });
    });

    it('sends payload and service parameters changed by beforeClientRequest', async () => {
      const client = createClient([
        recorder('headers', {
          beforeClientRequest: (req) => {
            req.payload = { id: 'replaced', tenant: '' };
            req.options.serviceParameters = { ...req.options.serviceParameters, 'x-trace': 'abc' };
          },
        }),
      ]);

      await client.getTask({ id: 't1', tenant: '' });

      const [sentParams, sentOptions] = transport.getTask.mock.calls[0];
      expect(sentParams).toEqual({ id: 'replaced', tenant: '' });
      expect(sentOptions.serviceParameters['x-trace']).toBe('abc');
    });

    it('does not leak headers set in place by a plugin into the caller options', async () => {
      const callerOptions = { serviceParameters: { 'x-caller': '1' } };
      const client = createClient([
        {
          name: 'in-place',
          beforeClientRequest: (req) => {
            req.options.serviceParameters!['traceparent'] = 'tp-1';
          },
        },
      ]);

      await client.getTask({ id: 't1', tenant: '' }, callerOptions);

      const [, sentOptions] = transport.getTask.mock.calls[0];
      expect(sentOptions.serviceParameters).toMatchObject({ 'x-caller': '1', traceparent: 'tp-1' });
      expect(callerOptions.serviceParameters).toEqual({ 'x-caller': '1' });
    });

    it('reports a transport error to afterClientRequest and rethrows it', async () => {
      const failure = new Error('network');
      transport.getTask.mockRejectedValue(failure);
      const client = createClient([recorder()]);

      await expect(client.getTask({ id: 't1', tenant: '' })).rejects.toBe(failure);

      expect(responses).toHaveLength(1);
      expect(responses[0]).toMatchObject({ error: failure, isFinal: true });
      expect(responses[0].payload).toBeUndefined();
    });

    it('cancels the call without calling the transport when beforeClientRequest throws', async () => {
      const rejection = new Error('denied');
      const client = createClient([
        recorder('outer'),
        {
          name: 'guard',
          beforeClientRequest: () => {
            throw rejection;
          },
        },
      ]);

      await expect(client.getTask({ id: 't1', tenant: '' })).rejects.toBe(rejection);

      expect(transport.getTask).not.toHaveBeenCalled();
      expect(calls).toEqual(['outer.before:GetTask', 'outer.after:final']);
    });

    it('runs plugins outside interceptors', async () => {
      const interceptor: CallInterceptor = {
        before: async () => void calls.push('interceptor.before'),
        after: async () => void calls.push('interceptor.after'),
      };
      const client = createClient([recorder()], [interceptor]);

      await client.getTask({ id: 't1', tenant: '' });

      expect(calls).toEqual([
        'recorder.before:GetTask',
        'recorder.around:GetTask',
        'interceptor.before',
        'interceptor.after',
        'recorder.after:final',
      ]);
    });

    it('reports an interceptor earlyReturn to plugins as the result', async () => {
      const interceptor: CallInterceptor = {
        before: async (args) => {
          args.earlyReturn = { method: 'getTask', value: task };
        },
        after: async () => {},
      };
      const client = createClient([recorder()], [interceptor]);

      await client.getTask({ id: 't1', tenant: '' });

      expect(transport.getTask).not.toHaveBeenCalled();
      expect(responses[0]).toMatchObject({ payload: task, isFinal: true });
    });

    it('passes the effective sendMessage configuration to plugins', async () => {
      const client = new Client(transport, agentCard, { plugins: [recorder()], polling: true });

      await client.sendMessage(sendParams());

      expect(requests[0].method).toBe('SendMessage');
      expect((requests[0].payload as SendMessageRequest).configuration?.returnImmediately).toBe(
        true
      );
    });

    it('runs hooks for getAgentCard only when it calls the server', async () => {
      transport.getExtendedAgentCard.mockResolvedValue(agentCard);
      const client = createClient([recorder()]);

      await client.getAgentCard();
      expect(requests.map((r) => r.method)).toEqual(['GetExtendedAgentCard']);

      const basicClient = new Client(
        transport,
        { ...agentCard, capabilities: { ...agentCard.capabilities!, extendedAgentCard: false } },
        { plugins: [recorder()] }
      );
      await basicClient.getAgentCard();
      expect(requests).toHaveLength(1);
    });

    it.each([
      ['ListTasks', (c: Client) => c.listTasks({ tenant: '' } as never)],
      ['CancelTask', (c: Client) => c.cancelTask({ id: 't1', tenant: '', metadata: {} })],
      [
        'CreateTaskPushNotificationConfig',
        (c: Client) => c.createTaskPushNotificationConfig({ taskId: 't1' } as never),
      ],
      [
        'GetTaskPushNotificationConfig',
        (c: Client) => c.getTaskPushNotificationConfig({ taskId: 't1', id: 'c', tenant: '' }),
      ],
      [
        'ListTaskPushNotificationConfigs',
        (c: Client) => c.listTaskPushNotificationConfig({ taskId: 't1', tenant: '' } as never),
      ],
      [
        'DeleteTaskPushNotificationConfig',
        (c: Client) => c.deleteTaskPushNotificationConfig({ taskId: 't1', id: 'c', tenant: '' }),
      ],
    ])('reports %s as the method name', async (method, invoke) => {
      const client = createClient([recorder()]);

      await invoke(client);

      expect(requests.map((r) => r.method)).toEqual([method]);
    });
  });

  describe('streaming calls', () => {
    const statusUpdate: StreamResponse = {
      payload: {
        $case: 'statusUpdate',
        value: { taskId: 't1', contextId: 'c1', status: task.status, metadata: {} },
      },
    };
    const taskEvent: StreamResponse = { payload: { $case: 'task', value: task } };

    it('runs afterClientRequest per event and once at the end', async () => {
      transport.sendMessageStream.mockReturnValue(events(taskEvent, statusUpdate));
      const client = createClient([recorder()]);

      const received: StreamResponse[] = [];
      for await (const event of client.sendMessageStream(sendParams())) {
        received.push(event);
      }

      expect(received).toEqual([taskEvent, statusUpdate]);
      expect(requests[0].method).toBe('SendStreamingMessage');
      expect(responses.filter((r) => r.isStreamEvent).map((r) => r.payload)).toEqual(received);
      expect(responses.at(-1)).toMatchObject({
        isFinal: true,
        isStreamEvent: false,
        error: undefined,
      });
      expect(calls.filter((c) => c.startsWith('recorder.around'))).toHaveLength(3);
    });

    it('reports SubscribeToTask for resubscribeTask', async () => {
      transport.resubscribeTask.mockReturnValue(events(taskEvent));
      const client = createClient([recorder()]);

      const stream = client.resubscribeTask({ id: 't1', tenant: '' });
      while (!(await stream.next()).done) {
        // drain
      }

      expect(requests[0].method).toBe('SubscribeToTask');
      expect(responses.map((r) => (r.isFinal ? 'final' : 'event'))).toEqual(['event', 'final']);
    });

    it('closes the transport stream and runs the final hook when the consumer stops early', async () => {
      let transportClosed = false;
      transport.sendMessageStream.mockReturnValue(
        (async function* () {
          try {
            yield taskEvent;
            yield statusUpdate;
          } finally {
            transportClosed = true;
          }
        })()
      );
      const client = createClient([recorder()]);

      const stream = client.sendMessageStream(sendParams());
      await stream.next();
      await stream.return();

      expect(transportClosed).toBe(true);
      expect(responses.filter((r) => r.isStreamEvent)).toHaveLength(1);
      expect(responses.at(-1)).toMatchObject({ isFinal: true, error: undefined });
    });

    it('reports a stream error to the final afterClientRequest and rethrows it', async () => {
      const failure = new Error('stream broke');
      transport.sendMessageStream.mockReturnValue(
        (async function* () {
          yield taskEvent;
          throw failure;
        })()
      );
      const client = createClient([recorder()]);

      const stream = client.sendMessageStream(sendParams());
      await stream.next();

      await expect(stream.next()).rejects.toBe(failure);
      expect(responses.at(-1)).toMatchObject({ isFinal: true, error: failure });
    });

    it('sends service parameters added by beforeClientRequest', async () => {
      transport.sendMessageStream.mockReturnValue(events(taskEvent));
      const client = createClient([
        {
          name: 'headers',
          beforeClientRequest: (req) => {
            req.options.serviceParameters = { 'x-trace': 'abc' };
          },
        },
      ]);

      const stream = client.sendMessageStream(sendParams());
      await stream.next();

      const [, sentOptions] = transport.sendMessageStream.mock.calls[0];
      expect(sentOptions.serviceParameters['x-trace']).toBe('abc');
    });

    it('runs hooks for the non-streaming fallback', async () => {
      const client = new Client(
        transport,
        { ...agentCard, capabilities: { ...agentCard.capabilities!, streaming: false } },
        { plugins: [recorder()] }
      );

      const stream = client.sendMessageStream(sendParams());
      while (!(await stream.next()).done) {
        // drain
      }

      expect(transport.sendMessage).toHaveBeenCalledOnce();
      expect(requests[0].method).toBe('SendStreamingMessage');
      expect(responses.map((r) => (r.isFinal ? 'final' : 'event'))).toEqual(['event', 'final']);
    });
  });

  it('runs several plugins in order: before forward, after in reverse', async () => {
    const client = createClient([recorder('a'), recorder('b')]);

    await client.getTask({ id: 't1', tenant: '' });

    expect(calls).toEqual([
      'a.before:GetTask',
      'b.before:GetTask',
      'a.around:GetTask',
      'b.around:GetTask',
      'b.after:final',
      'a.after:final',
    ]);
  });

  it('does not change behavior for plugins without client hooks', async () => {
    const client = createClient([{ name: 'tasks-only', onTaskEvent: vi.fn() }]);
    await expect(client.getTask({ id: 't1', tenant: '' })).resolves.toBe(task);
  });
});

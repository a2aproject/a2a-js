import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { DefaultRequestHandler, InMemoryTaskStore } from '../../../src/server/index.js';
import {
  AgentCard,
  Role,
  SendMessageRequest,
  StreamResponse,
  Task,
  TaskState,
} from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { TaskNotFoundError, UnsupportedOperationError } from '../../../src/errors/index.js';
import type { A2APlugin, ServerRequest, ServerResponse } from '../../../src/plugins/index.js';
import { MockAgentExecutor, fakeTaskExecute } from '../mocks/agent-executor.mock.js';

describe('DefaultRequestHandler server plugin hooks', () => {
  const agentCard: AgentCard = {
    name: 'Plugin Agent',
    description: 'Test agent for server plugin hooks',
    version: '1.0.0',
    provider: undefined,
    documentationUrl: '',
    supportedInterfaces: [
      {
        url: 'http://localhost/a2a',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    capabilities: { extensions: [], streaming: true, pushNotifications: false },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };

  const context = new ServerCallContext();
  let taskStore: InMemoryTaskStore;
  let executor: MockAgentExecutor;
  let calls: string[];
  let requests: ServerRequest[];
  let responses: ServerResponse[];

  /** Records every server hook call. */
  function recorder(name = 'recorder', overrides: Partial<A2APlugin> = {}): A2APlugin {
    return {
      name,
      beforeHandlerRun: (req) => {
        calls.push(`${name}.before:${req.method}`);
        requests.push(req);
      },
      aroundHandlerRun: (req, next) => {
        calls.push(`${name}.around:${req.method}`);
        return next();
      },
      afterHandlerRun: (res) => {
        calls.push(`${name}.after:${res.isFinal ? 'final' : 'event'}`);
        responses.push(res);
      },
      ...overrides,
    };
  }

  function createHandler(plugins: A2APlugin[]): DefaultRequestHandler {
    return new DefaultRequestHandler(
      agentCard,
      taskStore,
      executor,
      new DefaultExecutionEventBusManager(),
      undefined,
      undefined,
      undefined,
      undefined,
      { plugins }
    );
  }

  function sendParams(): SendMessageRequest {
    return {
      tenant: '',
      message: {
        messageId: crypto.randomUUID(),
        role: Role.ROLE_USER,
        parts: [
          { content: { $case: 'text', value: 'hi' }, mediaType: '', filename: '', metadata: {} },
        ],
        contextId: '',
        taskId: '',
        metadata: {},
        extensions: [],
        referenceTaskIds: [],
      },
      configuration: undefined,
      metadata: {},
    };
  }

  function task(id: string, state: TaskState): Task {
    return {
      id,
      contextId: 'ctx',
      status: { state, message: undefined, timestamp: undefined },
      artifacts: [],
      history: [],
      metadata: {},
    };
  }

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    executor = new MockAgentExecutor();
    executor.execute.mockImplementation(fakeTaskExecute);
    calls = [];
    requests = [];
    responses = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('unary calls', () => {
    it('runs before, around and after with the request and result', async () => {
      await taskStore.save(task('t1', TaskState.TASK_STATE_WORKING), context);
      const handler = createHandler([recorder()]);
      const params = { id: 't1', tenant: '' };

      const result = await handler.getTask(params, context);

      expect(result.id).toBe('t1');
      expect(calls).toEqual([
        'recorder.before:GetTask',
        'recorder.around:GetTask',
        'recorder.after:final',
      ]);
      expect(requests[0]).toEqual({ method: 'GetTask', payload: params, context, agentCard });
      expect(responses[0]).toEqual({
        method: 'GetTask',
        payload: result,
        context,
        isStreamEvent: false,
        isFinal: true,
      });
    });

    it('reports a handler error to afterHandlerRun and rethrows it', async () => {
      const handler = createHandler([recorder()]);

      await expect(handler.getTask({ id: 'missing', tenant: '' }, context)).rejects.toThrow(
        TaskNotFoundError
      );

      expect(responses).toHaveLength(1);
      expect(responses[0].error).toBeInstanceOf(TaskNotFoundError);
      expect(responses[0].payload).toBeUndefined();
      expect(responses[0].isFinal).toBe(true);
    });

    it('rejects the call without running the handler when beforeHandlerRun throws', async () => {
      const rejection = new Error('denied');
      const loadSpy = vi.spyOn(taskStore, 'load');
      const handler = createHandler([
        recorder('outer'),
        {
          name: 'guard',
          beforeHandlerRun: () => {
            throw rejection;
          },
        },
      ]);

      await expect(handler.getTask({ id: 't1', tenant: '' }, context)).rejects.toBe(rejection);

      expect(loadSpy).not.toHaveBeenCalled();
      expect(calls).toEqual(['outer.before:GetTask', 'outer.after:final']);
      expect(responses[0].error).toBe(rejection);
    });

    it('runs the handler inside aroundHandlerRun', async () => {
      let inside = false;
      const loadedInside: boolean[] = [];
      vi.spyOn(taskStore, 'load').mockImplementation(async () => {
        loadedInside.push(inside);
        return task('t1', TaskState.TASK_STATE_WORKING);
      });
      // Synchronous scope, like OpenTelemetry's context.with(ctx, next).
      const handler = createHandler([
        {
          name: 'scope',
          aroundHandlerRun: (_req, next) => {
            inside = true;
            try {
              return next();
            } finally {
              inside = false;
            }
          },
        },
      ]);

      await handler.getTask({ id: 't1', tenant: '' }, context);

      expect(loadedInside).toEqual([true]);
    });

    it.each([
      ['GetTask', (h: DefaultRequestHandler) => h.getTask({ id: 'x', tenant: '' }, context)],
      ['ListTasks', (h: DefaultRequestHandler) => h.listTasks({ tenant: '' } as never, context)],
      [
        'CancelTask',
        (h: DefaultRequestHandler) => h.cancelTask({ id: 'x', tenant: '', metadata: {} }, context),
      ],
      [
        'CreateTaskPushNotificationConfig',
        (h: DefaultRequestHandler) =>
          h.createTaskPushNotificationConfig({ taskId: 'x' } as never, context),
      ],
      [
        'GetTaskPushNotificationConfig',
        (h: DefaultRequestHandler) =>
          h.getTaskPushNotificationConfig({ taskId: 'x', id: 'c', tenant: '' }, context),
      ],
      [
        'ListTaskPushNotificationConfigs',
        (h: DefaultRequestHandler) =>
          h.listTaskPushNotificationConfigs({ taskId: 'x', tenant: '' } as never, context),
      ],
      [
        'DeleteTaskPushNotificationConfig',
        (h: DefaultRequestHandler) =>
          h.deleteTaskPushNotificationConfig({ taskId: 'x', id: 'c', tenant: '' }, context),
      ],
      [
        'GetExtendedAgentCard',
        (h: DefaultRequestHandler) => h.getAuthenticatedExtendedAgentCard({ tenant: '' }, context),
      ],
      ['SendMessage', (h: DefaultRequestHandler) => h.sendMessage(sendParams(), context)],
    ])('reports %s as the method name', async (method, invoke) => {
      const handler = createHandler([recorder()]);

      await invoke(handler).catch(() => {});

      expect(requests.map((r) => r.method)).toEqual([method]);
      expect(responses.map((r) => r.method)).toEqual([method]);
    });

    it('does not run hooks for getAgentCard', async () => {
      const handler = createHandler([recorder()]);
      await handler.getAgentCard();
      expect(calls).toEqual([]);
    });
  });

  describe('streaming calls', () => {
    it('runs afterHandlerRun per event and once at the end', async () => {
      const handler = createHandler([recorder()]);

      const events: StreamResponse[] = [];
      for await (const event of handler.sendMessageStream(sendParams(), context)) {
        events.push(event);
      }

      expect(events).toHaveLength(3);
      expect(requests[0].method).toBe('SendStreamingMessage');
      const streamEvents = responses.filter((r) => r.isStreamEvent);
      expect(streamEvents.map((r) => r.payload)).toEqual(events);
      expect(streamEvents.every((r) => !r.isFinal && r.error === undefined)).toBe(true);
      expect(responses.at(-1)).toEqual({
        method: 'SendStreamingMessage',
        context,
        error: undefined,
        isStreamEvent: false,
        isFinal: true,
      });
      expect(calls.filter((c) => c.endsWith(':final'))).toHaveLength(1);
    });

    it('wraps each pull in aroundHandlerRun, including the one that ends the stream', async () => {
      const handler = createHandler([recorder()]);

      const stream = handler.sendMessageStream(sendParams(), context);
      while (!(await stream.next()).done) {
        // drain
      }

      expect(calls.filter((c) => c.startsWith('recorder.around'))).toHaveLength(4);
    });

    it('runs the final afterHandlerRun when the consumer stops early', async () => {
      const handler = createHandler([recorder()]);

      const stream = handler.sendMessageStream(sendParams(), context);
      await stream.next();
      await stream.return();

      expect(responses.filter((r) => r.isStreamEvent)).toHaveLength(1);
      expect(responses.at(-1)).toMatchObject({ isFinal: true, error: undefined });
    });

    it('closes the inner stream when the consumer stops early', async () => {
      const busManager = new DefaultExecutionEventBusManager();
      const handler = new DefaultRequestHandler(
        agentCard,
        taskStore,
        executor,
        busManager,
        undefined,
        undefined,
        undefined,
        undefined,
        { plugins: [recorder()] }
      );
      await taskStore.save(task('live', TaskState.TASK_STATE_WORKING), context);
      const bus = busManager.createOrGetByTaskId('live', context);
      const offSpy = vi.spyOn(bus, 'off');

      const stream = handler.resubscribe({ id: 'live', tenant: '' }, context);
      await stream.next();
      await stream.return();

      // The inner generator's `finally` stops its ExecutionEventQueue.
      expect(offSpy).toHaveBeenCalledWith('event', expect.any(Function));
      expect(responses.at(-1)).toMatchObject({ isFinal: true, error: undefined });
    });

    it('reports a stream error to the final afterHandlerRun and rethrows it', async () => {
      const handler = createHandler([recorder()]);
      await taskStore.save(task('done', TaskState.TASK_STATE_COMPLETED), context);

      const stream = handler.resubscribe({ id: 'done', tenant: '' }, context);

      await expect(stream.next()).rejects.toThrow(UnsupportedOperationError);
      expect(requests[0].method).toBe('SubscribeToTask');
      expect(responses).toHaveLength(1);
      expect(responses[0].isFinal).toBe(true);
      expect(responses[0].error).toBeInstanceOf(UnsupportedOperationError);
    });

    it('rejects the stream on the first pull when beforeHandlerRun throws', async () => {
      const rejection = new Error('denied');
      const handler = createHandler([
        {
          name: 'guard',
          beforeHandlerRun: () => {
            throw rejection;
          },
        },
      ]);

      await expect(handler.sendMessageStream(sendParams(), context).next()).rejects.toBe(rejection);
      expect(executor.execute).not.toHaveBeenCalled();
    });

    it('yields the resubscribe snapshot through the hooks', async () => {
      const handler = createHandler([recorder()]);
      await taskStore.save(task('t2', TaskState.TASK_STATE_WORKING), context);

      const events: StreamResponse[] = [];
      for await (const event of handler.resubscribe({ id: 't2', tenant: '' }, context)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(responses.map((r) => (r.isFinal ? 'final' : 'event'))).toEqual(['event', 'final']);
    });
  });

  it('runs hooks of several plugins in order: before forward, after in reverse', async () => {
    await taskStore.save(task('t1', TaskState.TASK_STATE_WORKING), context);
    const handler = createHandler([recorder('a'), recorder('b')]);

    await handler.getTask({ id: 't1', tenant: '' }, context);

    expect(calls).toEqual([
      'a.before:GetTask',
      'b.before:GetTask',
      'a.around:GetTask',
      'b.around:GetTask',
      'b.after:final',
      'a.after:final',
    ]);
  });

  it('ignores plugins without server hooks', async () => {
    await taskStore.save(task('t1', TaskState.TASK_STATE_WORKING), context);
    const onTaskEvent = vi.fn();
    const handler = createHandler([{ name: 'tasks-only', onTaskEvent }]);

    const result = await handler.getTask({ id: 't1', tenant: '' }, context);

    expect(result.id).toBe('t1');
  });
});

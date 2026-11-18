import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { withExecutionPlugins } from '../../src/server/agent_execution/plugin_agent_executor.js';
import { RequestContext } from '../../src/server/agent_execution/request_context.js';
import {
  AgentEvent,
  AgentExecutionEvent,
  DefaultExecutionEventBus,
} from '../../src/server/events/execution_event_bus.js';
import { DefaultExecutionEventBusManager } from '../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../src/server/context.js';
import { DefaultRequestHandler, InMemoryTaskStore } from '../../src/server/index.js';
import { sequential, type A2APlugin } from '../../src/plugins/index.js';
import { AgentCard, Message, Role, TaskState } from '../../src/types/pb/a2a.js';
import { MockAgentExecutor, fakeTaskExecute } from './mocks/agent-executor.mock.js';

const message: Message = {
  messageId: 'm1',
  role: Role.ROLE_USER,
  parts: [
    { content: { $case: 'text' as const, value: 'hi' }, mediaType: '', filename: '', metadata: {} },
  ],
  contextId: '',
  taskId: '',
  metadata: {},
  extensions: [],
  referenceTaskIds: [],
};

function requestContext(): RequestContext {
  return new RequestContext(
    { tenant: '', message, configuration: undefined, metadata: {} },
    't1',
    'c1',
    new ServerCallContext()
  );
}

function statusEvent(state: TaskState): AgentExecutionEvent {
  return AgentEvent.statusUpdate({
    taskId: 't1',
    contextId: 'c1',
    status: { state, message: undefined, timestamp: undefined },
    metadata: {},
  });
}

describe('withExecutionPlugins', () => {
  let calls: string[];
  let errorSpy: ReturnType<typeof vi.spyOn>;

  /** Records every execution hook call. */
  function recorder(name = 'recorder', overrides: Partial<A2APlugin> = {}): A2APlugin {
    return {
      name,
      beforeExecution: () => void calls.push(`${name}.before`),
      aroundExecution: (_ctx, next) => {
        calls.push(`${name}.around`);
        return next();
      },
      onExecutionEvent: (_ctx, event) => void calls.push(`${name}.event:${event.kind}`),
      afterExecution: (_ctx, error) =>
        void calls.push(`${name}.after:${error === undefined ? 'ok' : 'error'}`),
      ...overrides,
    };
  }

  beforeEach(() => {
    calls = [];
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('returns the executor unchanged when no plugin has execution hooks', () => {
    const executor = new MockAgentExecutor();
    expect(
      withExecutionPlugins(executor, sequential({ name: 'tasks-only', onTaskEvent: () => {} }))
    ).toBe(executor);
  });

  it('runs before, around, per-event and after hooks around execute', async () => {
    const executor = new MockAgentExecutor();
    executor.execute.mockImplementation(async (_ctx, bus) => {
      calls.push('execute');
      bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));
    });
    const wrapped = withExecutionPlugins(executor, sequential(recorder()));
    const bus = new DefaultExecutionEventBus();
    const published: AgentExecutionEvent[] = [];
    bus.on('event', (event) => published.push(event));

    await wrapped.execute(requestContext(), bus);

    expect(calls).toEqual([
      'recorder.before',
      'recorder.around',
      'execute',
      'recorder.event:statusUpdate',
      'recorder.after:ok',
    ]);
    expect(published).toHaveLength(1);
  });

  it('reports the agent error to afterExecution and rethrows it', async () => {
    const failure = new Error('agent failed');
    const executor = new MockAgentExecutor();
    executor.execute.mockRejectedValue(failure);
    const afterExecution = vi.fn();
    const ctx = requestContext();
    const wrapped = withExecutionPlugins(executor, sequential({ name: 'p', afterExecution }));

    await expect(wrapped.execute(ctx, new DefaultExecutionEventBus())).rejects.toBe(failure);

    expect(afterExecution).toHaveBeenCalledWith(ctx, failure);
  });

  it('fails without running the agent when beforeExecution throws', async () => {
    const rejection = new Error('denied');
    const executor = new MockAgentExecutor();
    const wrapped = withExecutionPlugins(
      executor,
      sequential(recorder('outer'), {
        name: 'guard',
        beforeExecution: () => {
          throw rejection;
        },
      })
    );

    await expect(wrapped.execute(requestContext(), new DefaultExecutionEventBus())).rejects.toBe(
      rejection
    );

    expect(executor.execute).not.toHaveBeenCalled();
    expect(calls).toEqual(['outer.before', 'outer.after:error']);
  });

  it('runs the agent inside aroundExecution, including async work', async () => {
    let inside = false;
    const seen: boolean[] = [];
    const executor = new MockAgentExecutor();
    executor.execute.mockImplementation(async () => {
      seen.push(inside);
    });
    const wrapped = withExecutionPlugins(
      executor,
      sequential({
        name: 'scope',
        aroundExecution: (_ctx, next) => {
          inside = true;
          try {
            return next();
          } finally {
            inside = false;
          }
        },
      })
    );

    await wrapped.execute(requestContext(), new DefaultExecutionEventBus());

    expect(seen).toEqual([true]);
  });

  it('passes the real bus to the agent', async () => {
    const executor = new MockAgentExecutor();
    const wrapped = withExecutionPlugins(executor, sequential(recorder()));
    const bus = new DefaultExecutionEventBus();

    await wrapped.execute(requestContext(), bus);

    expect(executor.execute.mock.calls[0][1]).toBe(bus);
  });

  it.each([
    ['returns', async () => {}],
    [
      'throws',
      async () => {
        throw new Error('agent failed');
      },
    ],
  ])('stops reporting events once the agent %s', async (_, impl) => {
    const executor = new MockAgentExecutor();
    executor.execute.mockImplementation(impl);
    const wrapped = withExecutionPlugins(executor, sequential(recorder()));
    const bus = new DefaultExecutionEventBus();

    await wrapped.execute(requestContext(), bus).catch(() => {});
    bus.publish(statusEvent(TaskState.TASK_STATE_FAILED));

    expect(calls.filter((c) => c.startsWith('recorder.event'))).toEqual([]);
  });

  it('still publishes the event when onExecutionEvent throws', async () => {
    const executor = new MockAgentExecutor();
    executor.execute.mockImplementation(async (_ctx, bus) => {
      bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));
    });
    const wrapped = withExecutionPlugins(
      executor,
      sequential({
        name: 'failing',
        onExecutionEvent: () => {
          throw new Error('boom');
        },
      })
    );
    const bus = new DefaultExecutionEventBus();
    const published: AgentExecutionEvent[] = [];
    bus.on('event', (event) => published.push(event));

    await wrapped.execute(requestContext(), bus);

    expect(published).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "A2A plugin 'failing' failed in onExecutionEvent:",
      expect.any(Error)
    );
  });

  it('cancels without running hooks', async () => {
    const executor = new MockAgentExecutor();
    const wrapped = withExecutionPlugins(executor, sequential(recorder()));
    const bus = new DefaultExecutionEventBus();

    await wrapped.cancelTask('t1', bus);

    expect(executor.cancelTask).toHaveBeenCalledWith('t1', bus);
    expect(calls).toEqual([]);
  });

  describe('through DefaultRequestHandler', () => {
    const agentCard: AgentCard = {
      name: 'Plugin Agent',
      description: '',
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

    function createHandler(
      executor: MockAgentExecutor,
      plugins: A2APlugin[]
    ): DefaultRequestHandler {
      return new DefaultRequestHandler(
        agentCard,
        new InMemoryTaskStore(),
        executor,
        new DefaultExecutionEventBusManager(),
        undefined,
        undefined,
        undefined,
        undefined,
        { plugins }
      );
    }

    it('runs execution hooks for sendMessage and reports each agent event', async () => {
      const executor = new MockAgentExecutor();
      executor.execute.mockImplementation(fakeTaskExecute);
      const handler = createHandler(executor, [recorder()]);

      await handler.sendMessage(
        { tenant: '', message, configuration: undefined, metadata: {} },
        new ServerCallContext()
      );
      await vi.waitFor(() => expect(calls.at(-1)).toBe('recorder.after:ok'));

      expect(calls).toEqual([
        'recorder.before',
        'recorder.around',
        'recorder.event:task',
        'recorder.event:statusUpdate',
        'recorder.event:statusUpdate',
        'recorder.after:ok',
      ]);
    });

    it('does not report the synthetic failure events the SDK publishes', async () => {
      const executor = new MockAgentExecutor();
      executor.execute.mockRejectedValue(new Error('agent failed'));
      const handler = createHandler(executor, [recorder()]);

      const events: unknown[] = [];
      for await (const event of handler.sendMessageStream(
        { tenant: '', message, configuration: undefined, metadata: {} },
        new ServerCallContext()
      )) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(calls).toEqual(['recorder.before', 'recorder.around', 'recorder.after:error']);
    });
  });
});

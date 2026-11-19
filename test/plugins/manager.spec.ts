import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sequential,
  SequentialPluginManager,
  type A2APlugin,
  type ClientRequest,
  type PushRequest,
  type ServerRequest,
  type ServerResponse,
  type TaskEventInfo,
} from '../../src/plugins/index.js';
import { ServerCallContext } from '../../src/server/context.js';
import { RequestContext } from '../../src/server/agent_execution/request_context.js';
import { AgentEvent } from '../../src/server/events/execution_event_bus.js';
import { AgentCard, Role, TaskState } from '../../src/index.js';

const agentCard = { name: 'test' } as AgentCard;
const context = new ServerCallContext();

function serverRequest(): ServerRequest {
  return { method: 'GetTask', payload: { id: 't1' }, context, agentCard };
}

function serverResponse(): ServerResponse {
  return { method: 'GetTask', payload: {}, context, isStreamEvent: false, isFinal: true };
}

function clientRequest(): ClientRequest {
  return { method: 'GetTask', payload: { id: 't1' }, agentCard, options: {} };
}

function requestContext(): RequestContext {
  return new RequestContext(
    {
      tenant: '',
      message: { messageId: 'm1', role: Role.ROLE_USER, parts: [], contextId: 'c1' },
    } as never,
    't1',
    'c1',
    context
  );
}

/** A plugin implementing every hook, recording `<name>.<hook>` for each call. */
function recorder(name: string, calls: string[], overrides: Partial<A2APlugin> = {}): A2APlugin {
  const record = (hook: string) => () => {
    calls.push(`${name}.${hook}`);
  };
  const around =
    (hook: string) =>
    <T>(_: unknown, next: () => T): T => {
      calls.push(`${name}.${hook}:enter`);
      const result = next();
      calls.push(`${name}.${hook}:exit`);
      return result;
    };
  return {
    name,
    beforeHandlerRun: record('beforeHandlerRun'),
    afterHandlerRun: record('afterHandlerRun'),
    aroundHandlerRun: around('aroundHandlerRun'),
    beforeClientRequest: record('beforeClientRequest'),
    afterClientRequest: record('afterClientRequest'),
    aroundClientRequest: around('aroundClientRequest'),
    beforeExecution: record('beforeExecution'),
    onExecutionEvent: record('onExecutionEvent'),
    afterExecution: record('afterExecution'),
    aroundExecution: around('aroundExecution'),
    onTaskEvent: record('onTaskEvent'),
    beforePushSend: record('beforePushSend'),
    onPushSent: record('onPushSent'),
    ...overrides,
  };
}

describe('SequentialPluginManager', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('has*Hooks', () => {
    it('are false for an empty manager', () => {
      const manager = sequential();
      expect(manager.hasServerHooks).toBe(false);
      expect(manager.hasClientHooks).toBe(false);
      expect(manager.hasExecutionHooks).toBe(false);
      expect(manager.hasTaskHooks).toBe(false);
      expect(manager.hasPushHooks).toBe(false);
    });

    it('reflect which hook groups the plugins implement', () => {
      const manager = sequential(
        { name: 'server', afterHandlerRun: () => {} },
        { name: 'task', onTaskEvent: () => {} }
      );
      expect(manager.hasServerHooks).toBe(true);
      expect(manager.hasTaskHooks).toBe(true);
      expect(manager.hasClientHooks).toBe(false);
      expect(manager.hasExecutionHooks).toBe(false);
      expect(manager.hasPushHooks).toBe(false);
    });

    it('count only the hook groups a nested manager implements', () => {
      const manager = sequential(sequential(), sequential({ name: 'p', onPushSent: () => {} }));
      expect(manager.hasPushHooks).toBe(true);
      expect(manager.hasServerHooks).toBe(false);
    });
  });

  it('rejects values that are not plugins', () => {
    expect(() => new SequentialPluginManager(null as never)).toThrow(TypeError);
  });

  it('exposes the registered plugins in order', () => {
    const a = { name: 'a' };
    const b = { name: 'b' };
    expect(sequential(a, b).plugins).toEqual([a, b]);
  });

  it('runs before hooks in order and after hooks in reverse', async () => {
    const calls: string[] = [];
    const manager = sequential(recorder('a', calls), recorder('b', calls));

    await manager.beforeHandlerRun(serverRequest());
    await manager.afterHandlerRun(serverResponse());
    await manager.beforeClientRequest(clientRequest());
    await manager.afterClientRequest({
      method: 'GetTask',
      options: {},
      isStreamEvent: false,
      isFinal: true,
    });
    await manager.beforeExecution(requestContext());
    await manager.afterExecution(requestContext());

    expect(calls).toEqual([
      'a.beforeHandlerRun',
      'b.beforeHandlerRun',
      'b.afterHandlerRun',
      'a.afterHandlerRun',
      'a.beforeClientRequest',
      'b.beforeClientRequest',
      'b.afterClientRequest',
      'a.afterClientRequest',
      'a.beforeExecution',
      'b.beforeExecution',
      'b.afterExecution',
      'a.afterExecution',
    ]);
  });

  it('runs observer hooks in registration order', async () => {
    const calls: string[] = [];
    const manager = sequential(recorder('a', calls), recorder('b', calls));
    const info = { taskId: 't1', toState: TaskState.TASK_STATE_WORKING } as TaskEventInfo;

    manager.onExecutionEvent(requestContext(), AgentEvent.message({} as never));
    await manager.onTaskEvent(info);
    await manager.beforePushSend({} as PushRequest);
    await manager.onPushSent({} as never);

    expect(calls).toEqual([
      'a.onExecutionEvent',
      'b.onExecutionEvent',
      'a.onTaskEvent',
      'b.onTaskEvent',
      'a.beforePushSend',
      'b.beforePushSend',
      'a.onPushSent',
      'b.onPushSent',
    ]);
  });

  it('nests around hooks with the first plugin outermost and returns the result', () => {
    const calls: string[] = [];
    const manager = sequential(recorder('a', calls), { name: 'none' }, recorder('b', calls));

    const result = manager.aroundHandlerRun(serverRequest(), () => {
      calls.push('call');
      return 42;
    });

    expect(result).toBe(42);
    expect(calls).toEqual([
      'a.aroundHandlerRun:enter',
      'b.aroundHandlerRun:enter',
      'call',
      'b.aroundHandlerRun:exit',
      'a.aroundHandlerRun:exit',
    ]);
  });

  it('passes promises through around hooks unchanged', async () => {
    const manager = sequential(recorder('a', []));
    await expect(manager.aroundClientRequest(clientRequest(), async () => 'ok')).resolves.toBe(
      'ok'
    );
    await expect(manager.aroundExecution(requestContext(), async () => 'ok')).resolves.toBe('ok');
  });

  it('calls next directly when no plugin has around hooks', () => {
    const next = vi.fn(() => 'ok');
    expect(sequential().aroundHandlerRun(serverRequest(), next)).toBe('ok');
    expect(next).toHaveBeenCalledOnce();
  });

  it('lets a plugin modify the client request in beforeClientRequest', async () => {
    const manager = sequential({
      name: 'headers',
      beforeClientRequest: (req) => {
        req.options.serviceParameters = { 'x-trace': 'abc' };
      },
    });
    const request = clientRequest();
    await manager.beforeClientRequest(request);
    expect(request.options.serviceParameters).toEqual({ 'x-trace': 'abc' });
  });

  describe('when a before hook throws', () => {
    it('unwinds the server plugins that ran with the error and rethrows', async () => {
      const calls: string[] = [];
      const error = new Error('rejected');
      const responses: ServerResponse[] = [];
      const manager = sequential(
        recorder('a', calls, { afterHandlerRun: (r) => void responses.push(r) }),
        recorder('b', calls, {
          beforeHandlerRun: () => {
            throw error;
          },
        }),
        recorder('c', calls)
      );

      await expect(manager.beforeHandlerRun(serverRequest())).rejects.toBe(error);
      expect(calls).toEqual(['a.beforeHandlerRun']);
      expect(responses).toEqual([
        { method: 'GetTask', context, error, isStreamEvent: false, isFinal: true },
      ]);
    });

    it('unwinds the client plugins that ran with the error and rethrows', async () => {
      const error = new Error('rejected');
      const after = vi.fn();
      const manager = sequential(
        { name: 'a', afterClientRequest: after },
        {
          name: 'b',
          beforeClientRequest: () => {
            throw error;
          },
        }
      );

      await expect(manager.beforeClientRequest(clientRequest())).rejects.toBe(error);
      expect(after).toHaveBeenCalledWith(expect.objectContaining({ error, isFinal: true }));
    });

    it('unwinds the execution plugins that ran with the error and rethrows', async () => {
      const error = new Error('rejected');
      const after = vi.fn();
      const ctx = requestContext();
      const manager = sequential(
        { name: 'a', afterExecution: after },
        {
          name: 'b',
          beforeExecution: async () => {
            throw error;
          },
        }
      );

      await expect(manager.beforeExecution(ctx)).rejects.toBe(error);
      expect(after).toHaveBeenCalledWith(ctx, error);
    });

    it('propagates beforePushSend errors without running later plugins', async () => {
      const error = new Error('rejected');
      const later = vi.fn();
      const manager = sequential(
        {
          name: 'a',
          beforePushSend: () => {
            throw error;
          },
        },
        { name: 'b', beforePushSend: later }
      );

      await expect(manager.beforePushSend({} as PushRequest)).rejects.toBe(error);
      expect(later).not.toHaveBeenCalled();
    });
  });

  it('logs and swallows errors from after and observer hooks', async () => {
    const calls: string[] = [];
    const fail = () => {
      throw new Error('boom');
    };
    const manager = sequential(
      recorder('a', calls),
      {
        name: 'failing',
        afterHandlerRun: fail,
        afterClientRequest: async () => fail(),
        onExecutionEvent: fail,
        afterExecution: fail,
        onTaskEvent: fail,
        onPushSent: fail,
      },
      recorder('b', calls)
    );

    await manager.afterHandlerRun(serverResponse());
    await manager.afterClientRequest({
      method: 'GetTask',
      options: {},
      isStreamEvent: false,
      isFinal: true,
    });
    manager.onExecutionEvent(requestContext(), AgentEvent.message({} as never));
    await manager.afterExecution(requestContext());
    await manager.onTaskEvent({} as TaskEventInfo);
    await manager.onPushSent({} as never);

    expect(calls).toEqual([
      'b.afterHandlerRun',
      'a.afterHandlerRun',
      'b.afterClientRequest',
      'a.afterClientRequest',
      'a.onExecutionEvent',
      'b.onExecutionEvent',
      'b.afterExecution',
      'a.afterExecution',
      'a.onTaskEvent',
      'b.onTaskEvent',
      'a.onPushSent',
      'b.onPushSent',
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(6);
    expect(errorSpy).toHaveBeenCalledWith(
      "A2A plugin 'failing' failed in afterHandlerRun:",
      expect.any(Error)
    );
  });

  it('runs nested managers in place, preserving the overall order', async () => {
    const calls: string[] = [];
    const manager = sequential(
      recorder('a', calls),
      sequential(recorder('b', calls), recorder('c', calls)),
      recorder('d', calls)
    );

    await manager.beforeHandlerRun(serverRequest());
    await manager.afterHandlerRun(serverResponse());

    expect(calls).toEqual([
      'a.beforeHandlerRun',
      'b.beforeHandlerRun',
      'c.beforeHandlerRun',
      'd.beforeHandlerRun',
      'd.afterHandlerRun',
      'c.afterHandlerRun',
      'b.afterHandlerRun',
      'a.afterHandlerRun',
    ]);
  });

  it('skips plugins that do not implement a hook', async () => {
    const after = vi.fn();
    const manager = sequential({ name: 'empty' }, { name: 'a', afterHandlerRun: after });
    await manager.beforeHandlerRun(serverRequest());
    await manager.afterHandlerRun(serverResponse());
    expect(after).toHaveBeenCalledOnce();
  });
});

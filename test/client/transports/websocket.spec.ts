import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WebSocketTransport,
  WebSocketTransportFactory,
  type A2AWebSocket,
  type WebSocketTransportOptions,
} from '../../../src/client/transports/websocket.js';
import { Role, type SendMessageRequest } from '../../../src/types/pb/a2a.js';

class FakeSocket implements A2AWebSocket {
  readyState = 0;
  readonly sent: Array<Record<string, unknown>> = [];
  readonly closeCalls: Array<[number | undefined, string | undefined]> = [];
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  constructor(
    readonly endpoint = '',
    readonly protocols: string[] = [],
    open: 'open' | 'fail' | 'never' = 'open'
  ) {
    queueMicrotask(() => {
      if (open === 'open') {
        this.readyState = 1;
        this.emit('open', {});
      } else if (open === 'fail') {
        this.readyState = 3;
        this.emit('error', {});
        this.emit('close', { code: 1006 });
      }
    });
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push([code, reason]);
    this.readyState = 3;
    this.emit('close', { code, reason });
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  receive(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  receiveRaw(data: unknown): void {
    this.emit('message', { data });
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function request(): SendMessageRequest {
  return {
    message: {
      messageId: 'message-1',
      role: Role.ROLE_USER,
      parts: [],
    },
  } as SendMessageRequest;
}

function setup(options: Partial<WebSocketTransportOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const transport = new WebSocketTransport({
    endpoint: 'ws://agent.example/a2a/ws',
    webSocketFactory: (endpoint, protocols) => {
      const socket = new FakeSocket(endpoint, protocols);
      sockets.push(socket);
      return socket;
    },
    ...options,
  });
  return {
    transport,
    socket: () => sockets[sockets.length - 1],
    sockets,
  };
}

/** Waits for the nth outgoing frame and answers it with `reply`. */
async function respond(socket: () => FakeSocket, index: number, reply: Record<string, unknown>) {
  await vi.waitFor(() => expect(socket()?.sent.length).toBeGreaterThan(index));
  const frame = socket().sent[index];
  socket().receive({ jsonrpc: '2.0', id: frame.id, ...reply });
  return frame;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WebSocketTransport', () => {
  it('negotiates a2a.v1 and multiplexes unary calls by id', async () => {
    const { transport, socket } = setup({ headers: { authorization: 'Bearer test' } });

    const first = transport.sendMessage(request());
    const second = transport.sendMessage(request());
    await vi.waitFor(() => expect(socket().sent).toHaveLength(2));
    expect(socket().protocols).toEqual(['a2a.v1']);
    expect(socket().sent[0]).toMatchObject({ jsonrpc: '2.0', method: 'SendMessage', id: 1 });
    expect(socket().sent[1]).toMatchObject({ jsonrpc: '2.0', method: 'SendMessage', id: 2 });

    socket().receive({
      jsonrpc: '2.0',
      id: 2,
      result: { message: { messageId: 'response-2', role: 'ROLE_AGENT', parts: [] } },
    });
    socket().receive({
      jsonrpc: '2.0',
      id: 1,
      result: { message: { messageId: 'response-1', role: 'ROLE_AGENT', parts: [] } },
    });

    await expect(first).resolves.toMatchObject({ messageId: 'response-1' });
    await expect(second).resolves.toMatchObject({ messageId: 'response-2' });
    expect(transport.protocolName).toBe('WEBSOCKET');
    expect(transport.protocolVersion).toBe('1.0');
  });

  it('passes handshake headers to the socket factory', async () => {
    const factory = vi.fn(() => new FakeSocket());
    const transport = new WebSocketTransport({
      endpoint: 'ws://agent.example/a2a/ws',
      headers: { authorization: 'Bearer test' },
      webSocketFactory: factory,
    });
    await transport.connect();
    await transport.connect();
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith('ws://agent.example/a2a/ws', ['a2a.v1'], {
      headers: { authorization: 'Bearer test' },
    });
  });

  it('maps every unary operation onto its WebSocket method', async () => {
    const { transport, socket } = setup();
    const task = { id: 'task-1', contextId: 'ctx-1' };
    const config = { taskId: 'task-1', id: 'config-1', url: 'https://hook.example' };

    const cases: Array<[string, () => Promise<unknown>, unknown, unknown]> = [
      ['GetTask', () => transport.getTask({ id: 'task-1', tenant: '' }), task, { id: 'task-1' }],
      [
        'CancelTask',
        () => transport.cancelTask({ id: 'task-1', tenant: '', metadata: {} }),
        task,
        { id: 'task-1' },
      ],
      [
        'ListTasks',
        () => transport.listTasks({ tenant: '' } as never),
        { tasks: [task], nextPageToken: 'next' },
        { nextPageToken: 'next' },
      ],
      [
        'CreateTaskPushNotificationConfig',
        () => transport.createTaskPushNotificationConfig(config as never),
        config,
        { id: 'config-1' },
      ],
      [
        'GetTaskPushNotificationConfig',
        () =>
          transport.getTaskPushNotificationConfig({
            taskId: 'task-1',
            id: 'config-1',
            tenant: '',
          }),
        config,
        { id: 'config-1' },
      ],
      [
        'ListTaskPushNotificationConfigs',
        () =>
          transport.listTaskPushNotificationConfig({
            taskId: 'task-1',
            pageSize: 0,
            pageToken: '',
            tenant: '',
          }),
        { configs: [config] },
        { configs: [expect.objectContaining({ id: 'config-1' })] },
      ],
      [
        'DeleteTaskPushNotificationConfig',
        () =>
          transport.deleteTaskPushNotificationConfig({
            taskId: 'task-1',
            id: 'config-1',
            tenant: '',
          }),
        {},
        undefined,
      ],
      [
        'GetExtendedAgentCard',
        () => transport.getExtendedAgentCard({ tenant: '' }),
        { name: 'extended', description: '', version: '1.0.0' },
        { name: 'extended' },
      ],
    ];

    for (const [index, [method, call, result, expected]] of cases.entries()) {
      const pending = call();
      const frame = await respond(socket, index, { result });
      expect(frame.method).toBe(method);
      if (expected === undefined) await expect(pending).resolves.toBeUndefined();
      else await expect(pending).resolves.toMatchObject(expected as object);
    }
  });

  it('rejects a SendMessage response without a payload', async () => {
    const { transport, socket } = setup();
    const pending = transport.sendMessage(request());
    await respond(socket, 0, { result: {} });
    await expect(pending).rejects.toThrow('missing payload');
  });

  it('yields streaming result frames until streamEnd and cancels on iterator cleanup', async () => {
    const { transport, socket } = setup();

    const stream = transport.sendMessageStream(request());
    const first = stream.next();
    await vi.waitFor(() => expect(socket().sent).toHaveLength(1));
    const id = socket().sent[0].id;
    socket().receive({ jsonrpc: '2.0', id, result: { task: { id: 'task-1' } } });
    socket().receive({
      jsonrpc: '2.0',
      id,
      result: { statusUpdate: { taskId: 'task-1', status: { state: 'TASK_STATE_WORKING' } } },
    });
    expect((await first).value).toMatchObject({ payload: { $case: 'task' } });
    expect((await stream.next()).value).toMatchObject({ payload: { $case: 'statusUpdate' } });
    socket().receive({ jsonrpc: '2.0', id, streamEnd: true });
    await expect(stream.next()).resolves.toMatchObject({ done: true });

    const cancelled = transport.sendMessageStream(request());
    const pending = cancelled.next();
    await vi.waitFor(() => expect(socket().sent).toHaveLength(2));
    await cancelled.return(undefined);
    expect(socket().sent[2]).toMatchObject({ jsonrpc: '2.0', cancelStream: true });
    await pending;
  });

  it('subscribes to a task as a stream', async () => {
    const { transport, socket } = setup();
    const stream = transport.resubscribeTask({ id: 'task-1', tenant: '' });
    const next = stream.next();
    const frame = await respond(socket, 0, { result: { task: { id: 'task-1' } } });
    expect(frame.method).toBe('SubscribeToTask');
    expect((await next).value).toMatchObject({ payload: { $case: 'task' } });
    expect(stream[Symbol.asyncIterator]()).toBe(stream);
  });

  it('ends a stream with the typed error from an error frame', async () => {
    const { transport, socket } = setup();
    const stream = transport.sendMessageStream(request());
    const next = stream.next();
    await respond(socket, 0, { error: { code: -32001, message: 'Task not found' } });
    await expect(next).rejects.toMatchObject({ name: 'TaskNotFoundError' });
  });

  it('does not send anything when an unstarted stream is closed', async () => {
    const { transport, sockets } = setup();
    const stream = transport.sendMessageStream(request());
    await expect(stream.return(undefined)).resolves.toMatchObject({ done: true });
    await expect(stream.throw(new Error('stop'))).rejects.toThrow('stop');
    expect(sockets).toHaveLength(0);
  });

  it('cancels a started stream when the consumer throws into it', async () => {
    const { transport, socket } = setup();
    const stream = transport.sendMessageStream(request());
    const pending = stream.next();
    await vi.waitFor(() => expect(socket().sent).toHaveLength(1));
    await expect(stream.throw(new Error('consumer failed'))).rejects.toThrow('consumer failed');
    expect(socket().sent[1]).toMatchObject({ id: socket().sent[0].id, cancelStream: true });
    await expect(pending).rejects.toThrow('consumer failed');
  });

  it('aborts unary calls and streams through AbortSignal', async () => {
    const { transport, socket } = setup();

    const preAborted = AbortSignal.abort();
    await expect(
      transport.getTask({ id: 't', tenant: '' }, { signal: preAborted })
    ).rejects.toThrow('aborted');
    expect(socket().sent).toHaveLength(0);

    const unaryController = new AbortController();
    const unary = transport.getTask({ id: 't', tenant: '' }, { signal: unaryController.signal });
    await vi.waitFor(() => expect(socket().sent).toHaveLength(1));
    unaryController.abort();
    await expect(unary).rejects.toMatchObject({ name: 'AbortError' });
    // A late reply for an aborted call is dropped.
    socket().receive({ jsonrpc: '2.0', id: socket().sent[0].id, result: { id: 't' } });

    const streamController = new AbortController();
    const stream = transport.sendMessageStream(request(), { signal: streamController.signal });
    const next = stream.next();
    await vi.waitFor(() => expect(socket().sent).toHaveLength(2));
    streamController.abort();
    await expect(next).rejects.toMatchObject({ name: 'AbortError' });
    expect(socket().sent[2]).toMatchObject({ id: socket().sent[1].id, cancelStream: true });
  });

  it('maps JSON-RPC errors and sends per-request service parameters', async () => {
    const { transport, socket } = setup({ serviceParameters: { 'x-connection': 'yes' } });
    const call = transport.getTask(
      { id: 'missing', tenant: '' },
      { serviceParameters: { 'X-Request': 'one' } }
    );
    await vi.waitFor(() => expect(socket().sent).toHaveLength(1));
    expect(socket().sent[0]).toMatchObject({
      serviceParams: { 'x-connection': 'yes', 'x-request': 'one' },
    });
    socket().receive({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32001, message: 'Task not found' },
    });
    await expect(call).rejects.toMatchObject({ name: 'TaskNotFoundError' });
  });

  it('omits serviceParams when there are none', async () => {
    const { transport, socket } = setup();
    const call = transport.getTask({ id: 't', tenant: '' });
    const frame = await respond(socket, 0, { result: { id: 't' } });
    await call;
    expect(frame).not.toHaveProperty('serviceParams');
  });

  it('ignores frames that do not belong to a pending call', async () => {
    const { transport, socket } = setup();
    const call = transport.getTask({ id: 't', tenant: '' });
    await vi.waitFor(() => expect(socket().sent).toHaveLength(1));
    const id = socket().sent[0].id;

    socket().receive({ jsonrpc: '1.0', id, result: { id: 'wrong-version' } });
    socket().receive({ jsonrpc: '2.0', result: { id: 'no-id' } });
    socket().receive({ jsonrpc: '2.0', id: 999, result: { id: 'unknown' } });
    socket().receive({ jsonrpc: '2.0', id: 999, streamEnd: true });
    socket().receive({ jsonrpc: '2.0', id: 999, error: { code: -32603, message: 'x' } });
    socket().receive({ jsonrpc: '2.0', id });
    socket().receive({ jsonrpc: '2.0', id, result: { id: 't' } });

    await expect(call).resolves.toMatchObject({ id: 't' });
  });

  it.each([
    ['binary frames', (s: FakeSocket) => s.receiveRaw(new ArrayBuffer(1)), 1003, /binary/],
    ['invalid JSON', (s: FakeSocket) => s.receiveRaw('{oops'), 1002, /Invalid JSON/],
    [
      'oversized frames',
      (s: FakeSocket) => s.receive({ jsonrpc: '2.0', id: 1, result: { padding: 'x'.repeat(64) } }),
      1009,
      /maximum size/,
    ],
  ])('closes the connection and fails pending calls on %s', async (_name, send, code, message) => {
    const { transport, socket } = setup({ maxMessageBytes: 32 });
    const call = transport.getTask({ id: 't', tenant: '' });
    await vi.waitFor(() => expect(socket().sent).toHaveLength(1));
    send(socket());
    await expect(call).rejects.toThrow(message);
    expect(socket().closeCalls[0][0]).toBe(code);
  });

  it('runs the re-authentication hook and refreshes credentials in band', async () => {
    const onReauthenticationRequired = vi.fn();
    const credentialProvider = vi.fn(async () => ({ scheme: 'Bearer', credentials: 'fresh' }));
    const { socket, transport } = setup({ onReauthenticationRequired, credentialProvider });
    await transport.connect();

    socket().receive({
      jsonrpc: '2.0',
      control: 'ReauthenticationRequired',
      reason: 'token expiring',
      retryAfterMs: 500,
    });
    const frame = await respond(socket, 0, { result: {} });
    expect(onReauthenticationRequired).toHaveBeenCalledWith({
      reason: 'token expiring',
      retryAfterMs: 500,
    });
    expect(frame).toMatchObject({
      method: 'Authenticate',
      params: { scheme: 'Bearer', credentials: 'fresh' },
    });

    // A rejected refresh is swallowed; the server closes with 4001 instead.
    socket().receive({ jsonrpc: '2.0', control: 'ReauthenticationRequired' });
    await respond(socket, 1, { error: { code: -32004, message: 'not supported' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('describes close codes in connection errors', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ code: 4001 }, /authentication required/],
      [{ code: 1009 }, /peer maximum size/],
      [{ code: 1011, reason: 'server crashed' }, /\(1011\): server crashed/],
      [{}, /^WebSocket connection closed$/],
    ];
    for (const [event, message] of cases) {
      const { transport, socket } = setup();
      const call = transport.getTask({ id: 't', tenant: '' });
      await vi.waitFor(() => expect(socket().sent).toHaveLength(1));
      socket().readyState = 3;
      socket().emit('close', event);
      await expect(call).rejects.toThrow(message);
    }
  });

  it('rejects the connect promise when the handshake fails', async () => {
    const transport = new WebSocketTransport({
      endpoint: 'ws://agent.example/a2a/ws',
      webSocketFactory: () => new FakeSocket('', [], 'fail'),
    });
    await expect(transport.connect()).rejects.toThrow('WebSocket connection failed');
  });

  it('times out a handshake that never opens', async () => {
    let socket!: FakeSocket;
    const transport = new WebSocketTransport({
      endpoint: 'ws://agent.example/a2a/ws',
      connectTimeoutMs: 5,
      webSocketFactory: () => (socket = new FakeSocket('', [], 'never')),
    });
    await expect(transport.connect()).rejects.toThrow('timed out after 5ms');
    expect(socket.closeCalls[0]).toEqual([1001, 'connection timeout']);
  });

  it('survives a socket that throws while closing on timeout', async () => {
    const transport = new WebSocketTransport({
      endpoint: 'ws://agent.example/a2a/ws',
      connectTimeoutMs: 5,
      webSocketFactory: () => {
        const socket = new FakeSocket('', [], 'never');
        socket.close = () => {
          throw new Error('already closed');
        };
        return socket;
      },
    });
    await expect(transport.connect()).rejects.toThrow('timed out');
  });

  it('refuses new calls after close() and fails in-flight ones', async () => {
    const { transport, socket } = setup();
    const call = transport.getTask({ id: 't', tenant: '' });
    await vi.waitFor(() => expect(socket().sent).toHaveLength(1));
    await transport.destroy();
    await expect(call).rejects.toThrow('client closing');
    expect(socket().closeCalls[0]).toEqual([1000, 'client closing']);
    await expect(transport.getTask({ id: 't', tenant: '' })).rejects.toThrow('client closing');
  });

  it('reconnects with backoff after close()', async () => {
    let attempts = 0;
    const transport = new WebSocketTransport({
      endpoint: 'ws://agent.example/a2a/ws',
      webSocketFactory: () => new FakeSocket('', [], ++attempts < 3 ? 'fail' : 'open'),
    });
    transport.close();
    await transport.connectWithRetry({ initialDelayMs: 1, maxDelayMs: 2 });
    expect(attempts).toBe(3);
  });

  it('gives up reconnecting after maxAttempts', async () => {
    const transport = new WebSocketTransport({
      endpoint: 'ws://agent.example/a2a/ws',
      webSocketFactory: () => new FakeSocket('', [], 'fail'),
    });
    await expect(transport.connectWithRetry({ maxAttempts: 2, initialDelayMs: 1 })).rejects.toThrow(
      'WebSocket connection failed'
    );
  });

  it('uses the global WebSocket when no factory is provided', async () => {
    const created: FakeSocket[] = [];
    vi.stubGlobal(
      'WebSocket',
      class extends FakeSocket {
        constructor(url: string, protocols: string[]) {
          super(url, protocols);
          created.push(this);
        }
      }
    );
    const transport = new WebSocketTransport({ endpoint: 'ws://agent.example/a2a/ws' });
    await transport.connect();
    expect(created[0]).toMatchObject({
      endpoint: 'ws://agent.example/a2a/ws',
      protocols: ['a2a.v1'],
    });
  });

  it('explains how to proceed when no WebSocket implementation exists', async () => {
    vi.stubGlobal('WebSocket', undefined);
    const transport = new WebSocketTransport({ endpoint: 'ws://agent.example/a2a/ws' });
    await expect(transport.connect()).rejects.toThrow(/Provide webSocketFactory/);
  });
});

describe('WebSocketTransportFactory', () => {
  it('creates the WEBSOCKET transport from an Agent Card interface', async () => {
    const factory = new WebSocketTransportFactory({
      webSocketFactory: () => new FakeSocket(),
    });
    expect(factory.protocolName).toBe('WEBSOCKET');
    const transport = await factory.create('ws://localhost/a2a/ws', {
      name: 'agent',
      description: '',
      version: '1.0.0',
      supportedInterfaces: [],
    } as any);
    expect(transport.protocolName).toBe('WEBSOCKET');
  });
});

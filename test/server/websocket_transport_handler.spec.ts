import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WebSocketTransportHandler,
  adaptWebSocketConnection,
  type WebSocketConnection,
} from '../../src/server/transports/websocket/websocket_transport_handler.js';
import type { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { DefaultRequestHandler } from '../../src/server/request_handler/default_request_handler.js';
import { InMemoryTaskStore } from '../../src/server/store.js';
import type { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';
import {
  ServerCallContext,
  type ServerCallContextBuilderOptions,
} from '../../src/server/context.js';
import { A2A_ERROR_CODE } from '../../src/errors/index.js';
import type { AgentCard } from '../../src/types/pb/a2a.js';

class FakeConnection implements WebSocketConnection {
  readonly sent: unknown[] = [];
  closed?: { code?: number; reason?: string };
  ping?: () => void;
  failSend = false;
  private messageListener?: (data: unknown, isBinary?: boolean) => void;
  private closeListener?: (code?: number, reason?: string) => void;
  private errorListener?: (error: unknown) => void;

  send(data: string): void {
    if (this.failSend) throw new Error('socket write failed');
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.closeListener?.(code, reason);
  }

  onMessage(listener: (data: unknown, isBinary?: boolean) => void): () => void {
    this.messageListener = listener;
    return () => (this.messageListener = undefined);
  }

  onClose(listener: (code?: number, reason?: string) => void): () => void {
    this.closeListener = listener;
    return () => (this.closeListener = undefined);
  }

  onError(listener: (error: unknown) => void): () => void {
    this.errorListener = listener;
    return () => (this.errorListener = undefined);
  }

  receive(message: unknown, isBinary = false): void {
    this.messageListener?.(
      typeof message === 'string' ? message : JSON.stringify(message),
      isBinary
    );
  }

  emitError(error: unknown): void {
    this.errorListener?.(error);
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const agentCard = {
  name: 'agent',
  description: '',
  version: '1.0.0',
  capabilities: { streaming: true },
  supportedInterfaces: [
    { url: 'ws://localhost/a2a/ws', protocolBinding: 'WEBSOCKET', protocolVersion: '1.0' },
  ],
} as unknown as AgentCard;

function handler(overrides: Partial<A2ARequestHandler> = {}): A2ARequestHandler {
  return {
    getAgentCard: async () => agentCard,
    getAuthenticatedExtendedAgentCard: vi.fn(),
    sendMessage: vi.fn(async () => ({ messageId: 'response-1', role: 2, parts: [] })),
    sendMessageStream: vi.fn(async function* () {
      yield { payload: { $case: 'task', value: { id: 'task-1' } } };
      yield {
        payload: {
          $case: 'statusUpdate',
          value: { taskId: 'task-1', status: { state: 3 } },
        },
      };
    }),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
    createTaskPushNotificationConfig: vi.fn(),
    getTaskPushNotificationConfig: vi.fn(),
    listTaskPushNotificationConfigs: vi.fn(),
    deleteTaskPushNotificationConfig: vi.fn(async () => undefined),
    resubscribe: vi.fn(),
    listTasks: vi.fn(),
    ...overrides,
  } as A2ARequestHandler;
}

function sendMessage(id: string | number, extra: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'SendMessage',
    params: { message: { messageId: 'message-1', role: 'ROLE_USER', parts: [] as unknown[] } },
    ...extra,
  };
}

function streamMessage(id: string | number) {
  return { ...sendMessage(id), method: 'SendStreamingMessage' };
}

function capturingContext(): {
  requestHandler: A2ARequestHandler;
  context: () => ServerCallContext;
} {
  let seen: ServerCallContext | undefined;
  const requestHandler = handler({
    sendMessage: vi.fn(async (_params: unknown, context: ServerCallContext) => {
      seen = context;
      return { messageId: 'response-1', role: 2, parts: [] };
    }) as unknown as A2ARequestHandler['sendMessage'],
  });
  return { requestHandler, context: () => seen! };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WebSocketTransportHandler', () => {
  it('dispatches unary requests and carries connection/per-request service params', async () => {
    const { requestHandler, context } = capturingContext();
    const connection = new FakeConnection();
    new WebSocketTransportHandler(requestHandler, {
      handshake: { serviceParameters: { 'x-connection': 'yes' } },
    }).handleConnection(connection);

    connection.receive(sendMessage('request-1', { serviceParams: { 'X-Request': 'one' } }));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(connection.sent[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 'request-1',
      result: { message: { messageId: 'response-1' } },
    });
    expect(context().state.get('headers')).toEqual({ 'x-connection': 'yes', 'x-request': 'one' });
  });

  it('maps handshake headers to service params and drops upgrade-only headers', async () => {
    const { requestHandler, context } = capturingContext();
    const connection = new FakeConnection();
    new WebSocketTransportHandler(requestHandler, {
      handshake: {
        headers: {
          Host: 'agent.example',
          'Sec-WebSocket-Key': 'abc',
          'Sec-WebSocket-Protocol': 'a2a.v1',
          'A2A-Extensions': 'urn:ext:handshake',
          'X-Multi': ['a', 'b'],
          'X-Missing': undefined,
        },
      },
    }).handleConnection(connection);

    connection.receive(sendMessage(1));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(context().state.get('headers')).toEqual({
      'a2a-extensions': 'urn:ext:handshake',
      'x-multi': 'a, b',
    });
    expect(context().requestedExtensions).toEqual(['urn:ext:handshake']);
  });

  it('parses requested extensions from per-request service params', async () => {
    const { requestHandler, context } = capturingContext();
    const connection = new FakeConnection();
    new WebSocketTransportHandler(requestHandler).handleConnection(connection);

    connection.receive(
      sendMessage(1, { serviceParams: { 'a2a-extensions': 'urn:ext:a, urn:ext:b' } })
    );
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(context().requestedExtensions).toEqual(['urn:ext:a', 'urn:ext:b']);
  });

  it('keeps authenticator-owned params and the handshake user over request params', async () => {
    const { requestHandler, context } = capturingContext();
    const connection = new FakeConnection();
    const user = { isAuthenticated: true, userName: 'alice' };
    new WebSocketTransportHandler(requestHandler, {
      handshake: { user, authenticatedServiceParameters: { 'X-Principal': 'alice' } },
    }).handleConnection(connection);

    connection.receive(sendMessage(1, { serviceParams: { 'x-principal': 'mallory' } }));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(context().state.get('headers')).toEqual({ 'x-principal': 'alice' });
    expect(context().user).toBe(user);
  });

  it('uses a custom context builder', async () => {
    const contextBuilder = vi.fn(
      (options: ServerCallContextBuilderOptions) =>
        new ServerCallContext({
          requestedVersion: options.requestedVersion,
          tenant: 'custom-tenant',
        })
    );
    const { requestHandler, context } = capturingContext();
    const connection = new FakeConnection();
    new WebSocketTransportHandler(requestHandler, { contextBuilder }).handleConnection(connection);

    connection.receive(sendMessage(1));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(contextBuilder).toHaveBeenCalledOnce();
    expect(context().tenant).toBe('custom-tenant');
  });

  it('rejects an A2A-Version the agent card does not declare for WEBSOCKET', async () => {
    const connection = new FakeConnection();
    const requestHandler = handler();
    new WebSocketTransportHandler(requestHandler).handleConnection(connection);

    connection.receive(sendMessage('old', { serviceParams: { 'A2A-Version': '0.3' } }));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(connection.sent[0]).toMatchObject({
      id: 'old',
      error: { code: A2A_ERROR_CODE.VERSION_NOT_SUPPORTED },
    });
    expect(requestHandler.sendMessage).not.toHaveBeenCalled();
  });

  it('returns an internal error when the agent card cannot be loaded', async () => {
    const connection = new FakeConnection();
    new WebSocketTransportHandler(
      handler({
        getAgentCard: async () => {
          throw new Error('card store offline');
        },
      })
    ).handleConnection(connection);

    connection.receive(sendMessage(1));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(connection.sent[0]).toMatchObject({
      id: 1,
      error: { code: A2A_ERROR_CODE.INTERNAL_ERROR },
    });
  });

  it('forwards JSON-RPC errors from the dispatcher with the request id', async () => {
    const connection = new FakeConnection();
    new WebSocketTransportHandler(handler()).handleConnection(connection);

    connection.receive({ jsonrpc: '2.0', id: 3, method: 'NoSuchMethod', params: {} });
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(connection.sent[0]).toMatchObject({
      id: 3,
      error: { code: A2A_ERROR_CODE.METHOD_NOT_FOUND },
    });
  });

  it('answers a delete with an empty object result', async () => {
    const connection = new FakeConnection();
    new WebSocketTransportHandler(handler()).handleConnection(connection);

    connection.receive({
      jsonrpc: '2.0',
      id: 4,
      method: 'DeleteTaskPushNotificationConfig',
      params: { taskId: 'task-1', id: 'config-1' },
    });
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(connection.sent[0]).toEqual({ jsonrpc: '2.0', id: 4, result: {} });
  });

  it('rejects envelopes that are not JSON-RPC 2.0 requests', async () => {
    const connection = new FakeConnection();
    new WebSocketTransportHandler(handler()).handleConnection(connection);

    connection.receive({ jsonrpc: '1.0', id: 'a', method: 'SendMessage' });
    connection.receive({ jsonrpc: '1.0', id: 1.5, method: 'SendMessage' });
    connection.receive({ jsonrpc: '2.0', id: '', method: 'SendMessage' });
    connection.receive({ jsonrpc: '2.0', id: 'b' });
    connection.receive({ jsonrpc: '2.0', id: 'c', method: 'Authenticate', params: {} });

    await vi.waitFor(() => expect(connection.sent).toHaveLength(5));
    expect(connection.sent).toEqual([
      expect.objectContaining({ id: 'a', error: expect.objectContaining({ code: -32600 }) }),
      expect.objectContaining({ id: null, error: expect.objectContaining({ code: -32600 }) }),
      expect.objectContaining({ id: null, error: expect.objectContaining({ code: -32600 }) }),
      expect.objectContaining({ id: 'b', error: expect.objectContaining({ code: -32600 }) }),
      expect.objectContaining({
        id: 'c',
        error: expect.objectContaining({ code: A2A_ERROR_CODE.UNSUPPORTED_OPERATION }),
      }),
    ]);
    expect(connection.closed).toBeUndefined();
  });

  it('emits ordered stream results followed by streamEnd', async () => {
    const connection = new FakeConnection();
    new WebSocketTransportHandler(handler()).handleConnection(connection);
    connection.receive(streamMessage(7));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(3));
    expect(connection.sent[0]).toMatchObject({ id: 7, result: { task: { id: 'task-1' } } });
    expect(connection.sent[1]).toMatchObject({
      id: 7,
      result: { statusUpdate: { taskId: 'task-1' } },
    });
    expect(connection.sent[2]).toEqual({ jsonrpc: '2.0', id: 7, streamEnd: true });
  });

  it('sends a stream error frame instead of streamEnd when the stream fails', async () => {
    const connection = new FakeConnection();
    new WebSocketTransportHandler(
      handler({
        sendMessageStream: vi.fn(async function* () {
          yield { payload: { $case: 'task', value: { id: 'task-1' } } };
          throw new Error('executor crashed');
        }) as unknown as A2ARequestHandler['sendMessageStream'],
      })
    ).handleConnection(connection);

    connection.receive(streamMessage('s'));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(2));
    expect(connection.sent[1]).toMatchObject({ id: 's', error: { code: expect.any(Number) } });
    expect(connection.sent[1]).not.toHaveProperty('streamEnd');
  });

  it('surfaces the request handler streaming-capability check as an error frame', async () => {
    const card = { ...agentCard, capabilities: { streaming: false } } as AgentCard;
    const executor: AgentExecutor = {
      execute: vi.fn(async () => undefined),
      cancelTask: vi.fn(async () => undefined),
    };
    const connection = new FakeConnection();
    new WebSocketTransportHandler(
      new DefaultRequestHandler(card, new InMemoryTaskStore(), executor)
    ).handleConnection(connection);

    connection.receive(streamMessage('no-stream'));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(connection.sent[0]).toMatchObject({
      id: 'no-stream',
      error: { code: A2A_ERROR_CODE.UNSUPPORTED_OPERATION },
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('cancels one stream with cancelStream while keeping the connection open', async () => {
    const gate = deferred();
    let finished = false;
    const connection = new FakeConnection();
    new WebSocketTransportHandler(
      handler({
        sendMessageStream: vi.fn(async function* () {
          try {
            yield { payload: { $case: 'task', value: { id: 'task-1' } } };
            await gate.promise;
            yield { payload: { $case: 'task', value: { id: 'task-1' } } };
          } finally {
            finished = true;
          }
        }) as unknown as A2ARequestHandler['sendMessageStream'],
      })
    ).handleConnection(connection);

    connection.receive(streamMessage(9));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    connection.receive({ jsonrpc: '2.0', id: 9, cancelStream: true });
    await vi.waitFor(() => expect(connection.sent).toHaveLength(2));
    expect(connection.sent[1]).toEqual({ jsonrpc: '2.0', id: 9, streamEnd: true });

    // A second cancel for the same id is a no-op.
    connection.receive({ jsonrpc: '2.0', id: 9, cancelStream: true });
    gate.resolve();
    await vi.waitFor(() => expect(finished).toBe(true));
    expect(connection.sent).toHaveLength(2);
    expect(connection.closed).toBeUndefined();
  });

  it('limits concurrent streams per connection', async () => {
    const gate = deferred();
    const connection = new FakeConnection();
    new WebSocketTransportHandler(
      handler({
        sendMessageStream: vi.fn(async function* () {
          yield { payload: { $case: 'task', value: { id: 'task-1' } } };
          await gate.promise;
        }) as unknown as A2ARequestHandler['sendMessageStream'],
      }),
      { maxConcurrentStreams: 1 }
    ).handleConnection(connection);

    connection.receive(streamMessage(1));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    connection.receive(streamMessage(2));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(2));
    expect(connection.sent[1]).toMatchObject({ id: 2, error: { code: -32000 } });

    gate.resolve();
    await vi.waitFor(() => expect(connection.sent).toHaveLength(3));
    expect(connection.sent[2]).toEqual({ jsonrpc: '2.0', id: 1, streamEnd: true });
  });

  it('stops active streams when the peer closes the connection', async () => {
    const gate = deferred();
    let finished = false;
    const connection = new FakeConnection();
    new WebSocketTransportHandler(
      handler({
        sendMessageStream: vi.fn(async function* () {
          try {
            yield { payload: { $case: 'task', value: { id: 'task-1' } } };
            await gate.promise;
            yield { payload: { $case: 'task', value: { id: 'task-1' } } };
          } finally {
            finished = true;
          }
        }) as unknown as A2ARequestHandler['sendMessageStream'],
      })
    ).handleConnection(connection);

    connection.receive(streamMessage(1));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    connection.close(1000, 'bye');
    gate.resolve();
    await vi.waitFor(() => expect(finished).toBe(true));
    expect(connection.sent).toHaveLength(1);

    connection.receive(sendMessage(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(connection.sent).toHaveLength(1);
  });

  it('detaches listeners and stops streams through the cleanup function', async () => {
    const gate = deferred();
    let finished = false;
    const connection = new FakeConnection();
    const cleanup = new WebSocketTransportHandler(
      handler({
        sendMessageStream: vi.fn(async function* () {
          try {
            yield { payload: { $case: 'task', value: { id: 'task-1' } } };
            await gate.promise;
          } finally {
            finished = true;
          }
        }) as unknown as A2ARequestHandler['sendMessageStream'],
      })
    ).handleConnection(connection);

    connection.receive(streamMessage(1));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    cleanup();
    cleanup();
    gate.resolve();
    await vi.waitFor(() => expect(finished).toBe(true));

    connection.receive(sendMessage(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(connection.sent).toHaveLength(1);
  });

  it('ignores frames after a socket error', async () => {
    const connection = new FakeConnection();
    new WebSocketTransportHandler(handler()).handleConnection(connection);
    connection.emitError(new Error('reset'));
    connection.receive(sendMessage(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(connection.sent).toHaveLength(0);
  });

  it('closes on malformed JSON and binary frames with the spec close codes', async () => {
    const malformed = new FakeConnection();
    new WebSocketTransportHandler(handler()).handleConnection(malformed);
    malformed.receive('{not-json');
    await vi.waitFor(() => expect(malformed.closed?.code).toBe(1002));
    expect(malformed.sent[0]).toMatchObject({ id: null, error: { code: -32700 } });

    const binary = new FakeConnection();
    new WebSocketTransportHandler(handler()).handleConnection(binary);
    binary.receive(new Uint8Array([1, 2]), true);
    await vi.waitFor(() => expect(binary.closed?.code).toBe(1003));
  });

  it('closes with 1009 when a frame exceeds maxMessageBytes', async () => {
    const connection = new FakeConnection();
    new WebSocketTransportHandler(handler(), { maxMessageBytes: 16 }).handleConnection(connection);
    connection.receive(sendMessage(1));
    await vi.waitFor(() => expect(connection.closed?.code).toBe(1009));
    expect(connection.sent).toHaveLength(0);
  });

  it('closes with 1011 when a response cannot be written', async () => {
    const connection = new FakeConnection();
    connection.failSend = true;
    new WebSocketTransportHandler(handler()).handleConnection(connection);
    connection.receive(sendMessage(1));
    await vi.waitFor(() => expect(connection.closed?.code).toBe(1011));
  });

  it('pings on the configured interval and closes idle connections', async () => {
    vi.useFakeTimers();
    const connection = new FakeConnection();
    connection.ping = vi.fn();
    new WebSocketTransportHandler(handler(), {
      pingIntervalMs: 100,
      idleTimeoutMs: 250,
    }).handleConnection(connection);

    await vi.advanceTimersByTimeAsync(100);
    expect(connection.ping).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(connection.closed).toEqual({ code: 1001, reason: 'idle timeout' });
  });

  it('checks idleness without pings when only idleTimeoutMs is set', async () => {
    vi.useFakeTimers();
    const connection = new FakeConnection();
    const cleanup = new WebSocketTransportHandler(handler(), {
      idleTimeoutMs: 50,
    }).handleConnection(connection);

    await vi.advanceTimersByTimeAsync(50);
    expect(connection.closed?.code).toBe(1001);
    cleanup();
  });

  it.each([
    ['the peer closes', (c: FakeConnection) => c.close(1000, 'bye')],
    ['the socket errors', (c: FakeConnection) => c.emitError(new Error('reset'))],
  ])('stops the liveness timer when %s', async (_name, end) => {
    vi.useFakeTimers();
    const connection = new FakeConnection();
    connection.ping = vi.fn();
    new WebSocketTransportHandler(handler(), { pingIntervalMs: 100 }).handleConnection(connection);
    expect(vi.getTimerCount()).toBe(1);

    end(connection);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(connection.ping).not.toHaveBeenCalled();
  });

  it('stops the liveness timer after an idle timeout', async () => {
    vi.useFakeTimers();
    const connection = new FakeConnection();
    connection.ping = vi.fn();
    // Detach the close listener so the timeout path cannot rely on the peer echoing a close.
    connection.close = (code, reason) => {
      connection.closed = { code, reason };
    };
    new WebSocketTransportHandler(handler(), {
      pingIntervalMs: 100,
      idleTimeoutMs: 100,
    }).handleConnection(connection);

    await vi.advanceTimersByTimeAsync(100);
    expect(connection.closed?.code).toBe(1001);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops active streams on a socket error and keeps cleanup() safe to call', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    let finished = false;
    const connection = new FakeConnection();
    const cleanup = new WebSocketTransportHandler(
      handler({
        sendMessageStream: vi.fn(async function* () {
          try {
            yield { payload: { $case: 'task', value: { id: 'task-1' } } };
            await gate.promise;
          } finally {
            finished = true;
          }
        }) as unknown as A2ARequestHandler['sendMessageStream'],
      }),
      { pingIntervalMs: 100 }
    ).handleConnection(connection);

    connection.receive(streamMessage(1));
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    connection.emitError(new Error('reset'));
    cleanup();
    gate.resolve();
    await vi.waitFor(() => expect(finished).toBe(true));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('adaptWebSocketConnection', () => {
  it('returns an already-normalized connection unchanged', () => {
    const connection = new FakeConnection();
    expect(adaptWebSocketConnection(connection)).toBe(connection);
  });

  it('adapts EventTarget-style sockets', () => {
    const target = new EventTarget();
    const socket = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      ping: vi.fn(),
      addEventListener: (type: string, listener: (event: any) => void) =>
        target.addEventListener(type, listener as EventListener),
      removeEventListener: (type: string, listener: (event: any) => void) =>
        target.removeEventListener(type, listener as EventListener),
    };
    const emit = (type: string, fields: Record<string, unknown>) =>
      target.dispatchEvent(Object.assign(new Event(type), fields));

    const connection = adaptWebSocketConnection(socket);
    const messages: Array<[unknown, boolean | undefined]> = [];
    const closes: Array<[number | undefined, string | undefined]> = [];
    const errors: unknown[] = [];
    const offMessage = connection.onMessage((data, isBinary) => messages.push([data, isBinary]));
    connection.onClose((code, reason) => closes.push([code, reason]));
    const offError = connection.onError!((error) => errors.push(error));

    emit('message', { data: 'hello' });
    emit('message', { data: new ArrayBuffer(2) });
    emit('close', { code: 1000, reason: 'done' });
    emit('error', {});
    offMessage();
    offError();
    emit('message', { data: 'ignored' });
    emit('error', {});
    connection.send('x');
    connection.close(1000, 'bye');
    connection.ping!();

    expect(messages).toEqual([
      ['hello', false],
      [expect.any(ArrayBuffer), true],
    ]);
    expect(closes).toEqual([[1000, 'done']]);
    expect(errors).toHaveLength(1);
    expect(socket.send).toHaveBeenCalledWith('x');
    expect(socket.close).toHaveBeenCalledWith(1000, 'bye');
    expect(socket.ping).toHaveBeenCalled();
    expect(connection.readyState).toBe(1);
  });

  it('adapts Node ws-style sockets and decodes text buffers', () => {
    const emitter = new EventEmitter();
    const socket = Object.assign(emitter, { readyState: 1, send: vi.fn(), close: vi.fn() });
    const connection = adaptWebSocketConnection(socket as never);
    const messages: Array<[unknown, boolean | undefined]> = [];
    const closes: Array<[number | undefined, string | undefined]> = [];
    const errors: unknown[] = [];
    const offMessage = connection.onMessage((data, isBinary) => messages.push([data, isBinary]));
    const offClose = connection.onClose((code, reason) => closes.push([code, reason]));
    connection.onError!((error) => errors.push(error));

    const binary = Buffer.from([0xff]);
    emitter.emit('message', 'text', false);
    emitter.emit('message', Buffer.from('{"a":1}'), false);
    emitter.emit('message', binary, true);
    emitter.emit('message', { unexpected: true }, false);
    emitter.emit('close', 1001, Buffer.from('going away'));
    emitter.emit('close', 'not-a-code', 'plain reason');
    emitter.emit('error', new Error('boom'));
    offMessage();
    offClose();
    emitter.emit('message', 'ignored', false);
    emitter.emit('close', 1000, 'ignored');

    expect(messages).toEqual([
      ['text', false],
      ['{"a":1}', false],
      [binary, true],
      [{ unexpected: true }, true],
    ]);
    expect(closes).toEqual([
      [1001, 'going away'],
      [undefined, 'plain reason'],
    ]);
    expect(errors).toEqual([expect.any(Error)]);
    expect(connection.ping).toBeUndefined();
  });

  it('rejects objects without an event API', () => {
    expect(() => adaptWebSocketConnection({ send: vi.fn(), close: vi.fn() } as never)).toThrow(
      /EventTarget or Node event methods/
    );
  });
});

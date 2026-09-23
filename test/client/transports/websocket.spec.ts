import { describe, expect, it, vi } from 'vitest';
import {
  WebSocketTransport,
  WebSocketTransportFactory,
  type A2AWebSocket,
} from '../../../src/client/transports/websocket.js';
import { Role, type SendMessageRequest } from '../../../src/types/pb/a2a.js';

class FakeSocket implements A2AWebSocket {
  readyState = 0;
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  constructor() {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000, reason = ''): void {
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

  private emit(type: string, event: unknown): void {
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

describe('WebSocketTransport', () => {
  it('negotiates a2a.v1 and multiplexes unary calls by id', async () => {
    let socket!: FakeSocket;
    const transport = new WebSocketTransport({
      endpoint: 'wss://agent.example/a2a/ws',
      webSocketFactory: (_endpoint, protocols) => {
        expect(protocols).toEqual(['a2a.v1']);
        socket = new FakeSocket();
        return socket;
      },
    });

    const first = transport.sendMessage(request());
    const second = transport.sendMessage(request());
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(socket.sent[0]).toMatchObject({ jsonrpc: '2.0', method: 'SendMessage', id: 1 });
    expect(socket.sent[1]).toMatchObject({ jsonrpc: '2.0', method: 'SendMessage', id: 2 });

    socket.receive({
      jsonrpc: '2.0',
      id: 2,
      result: { message: { messageId: 'response-2', role: 'ROLE_AGENT', parts: [] } },
    });
    socket.receive({
      jsonrpc: '2.0',
      id: 1,
      result: { message: { messageId: 'response-1', role: 'ROLE_AGENT', parts: [] } },
    });

    await expect(first).resolves.toMatchObject({ messageId: 'response-1' });
    await expect(second).resolves.toMatchObject({ messageId: 'response-2' });
  });

  it('yields streaming result frames until streamEnd and cancels on iterator cleanup', async () => {
    let socket!: FakeSocket;
    const transport = new WebSocketTransport({
      endpoint: 'ws://agent.example/a2a/ws',
      webSocketFactory: () => {
        socket = new FakeSocket();
        return socket;
      },
    });

    const stream = transport.sendMessageStream(request());
    const first = stream.next();
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    const id = (socket.sent[0] as { id: number }).id;
    socket.receive({ jsonrpc: '2.0', id, result: { task: { id: 'task-1' } } });
    socket.receive({
      jsonrpc: '2.0',
      id,
      result: { statusUpdate: { taskId: 'task-1', status: { state: 'TASK_STATE_WORKING' } } },
    });
    expect((await first).value).toMatchObject({ payload: { $case: 'task' } });
    expect((await stream.next()).value).toMatchObject({ payload: { $case: 'statusUpdate' } });
    socket.receive({ jsonrpc: '2.0', id, streamEnd: true });
    await expect(stream.next()).resolves.toMatchObject({ done: true });

    const cancelled = transport.sendMessageStream(request());
    const pending = cancelled.next();
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    await cancelled.return(undefined);
    expect(socket.sent[2]).toMatchObject({ jsonrpc: '2.0', cancelStream: true });
    await pending;
  });

  it('maps JSON-RPC errors and sends per-request service parameters', async () => {
    let socket!: FakeSocket;
    const transport = new WebSocketTransport({
      endpoint: 'ws://agent.example/a2a/ws',
      serviceParameters: { 'x-connection': 'yes' },
      webSocketFactory: () => {
        socket = new FakeSocket();
        return socket;
      },
    });
    const call = transport.getTask(
      { id: 'missing', tenant: '' },
      { serviceParameters: { 'X-Request': 'one' } }
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(socket.sent[0]).toMatchObject({
      serviceParams: { 'x-connection': 'yes', 'x-request': 'one' },
    });
    socket.receive({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32001, message: 'Task not found' },
    });
    await expect(call).rejects.toMatchObject({ name: 'TaskNotFoundError' });
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

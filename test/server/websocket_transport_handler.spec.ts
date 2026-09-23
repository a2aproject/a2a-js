import { describe, expect, it, vi } from 'vitest';
import {
  WebSocketTransportHandler,
  type WebSocketConnection,
} from '../../src/server/transports/websocket/websocket_transport_handler.js';
import type { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';

class FakeConnection implements WebSocketConnection {
  readonly sent: unknown[] = [];
  closed?: { code?: number; reason?: string };
  private messageListener?: (data: unknown, isBinary?: boolean) => void;
  private closeListener?: (code?: number, reason?: string) => void;

  send(data: string): void {
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

  receive(message: unknown, isBinary = false): void {
    this.messageListener?.(
      typeof message === 'string' ? message : JSON.stringify(message),
      isBinary
    );
  }
}

function handler(overrides: Partial<A2ARequestHandler> = {}): A2ARequestHandler {
  return {
    getAgentCard: async () => ({ capabilities: { streaming: true } }),
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
    deleteTaskPushNotificationConfig: vi.fn(),
    resubscribe: vi.fn(),
    listTasks: vi.fn(),
    ...overrides,
  } as A2ARequestHandler;
}

describe('WebSocketTransportHandler', () => {
  it('dispatches unary requests and carries connection/per-request service params', async () => {
    let seenHeaders: unknown;
    const requestHandler = handler({
      sendMessage: vi.fn(async (_params: any, context: any) => {
        seenHeaders = context.state.get('headers');
        return { messageId: 'response-1', role: 2, parts: [] };
      }) as unknown as A2ARequestHandler['sendMessage'],
    });
    const connection = new FakeConnection();
    new WebSocketTransportHandler(requestHandler, {
      handshake: { serviceParameters: { 'x-connection': 'yes' } },
    }).handleConnection(connection);

    connection.receive({
      jsonrpc: '2.0',
      id: 'request-1',
      method: 'SendMessage',
      params: { message: { messageId: 'message-1', role: 'ROLE_USER', parts: [] } },
      serviceParams: { 'X-Request': 'one' },
    });
    await vi.waitFor(() => expect(connection.sent).toHaveLength(1));
    expect(connection.sent[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 'request-1',
      result: { message: { messageId: 'response-1' } },
    });
    expect(seenHeaders).toEqual({ 'x-connection': 'yes', 'x-request': 'one' });
  });

  it('emits ordered stream results followed by streamEnd', async () => {
    const connection = new FakeConnection();
    new WebSocketTransportHandler(handler()).handleConnection(connection);
    connection.receive({
      jsonrpc: '2.0',
      id: 7,
      method: 'SendStreamingMessage',
      params: { message: { messageId: 'message-1', role: 'ROLE_USER', parts: [] } },
    });
    await vi.waitFor(() => expect(connection.sent).toHaveLength(3));
    expect(connection.sent[0]).toMatchObject({ id: 7, result: { task: { id: 'task-1' } } });
    expect(connection.sent[1]).toMatchObject({
      id: 7,
      result: { statusUpdate: { taskId: 'task-1' } },
    });
    expect(connection.sent[2]).toEqual({ jsonrpc: '2.0', id: 7, streamEnd: true });
  });

  it('closes on malformed JSON and binary frames with the spec close codes', async () => {
    const malformed = new FakeConnection();
    new WebSocketTransportHandler(handler()).handleConnection(malformed);
    malformed.receive('{not-json');
    expect(malformed.sent[0]).toMatchObject({ id: null, error: { code: -32700 } });
    expect(malformed.closed?.code).toBe(1002);

    const binary = new FakeConnection();
    new WebSocketTransportHandler(handler()).handleConnection(binary);
    binary.receive(new Uint8Array([1, 2]), true);
    expect(binary.closed?.code).toBe(1003);
  });
});

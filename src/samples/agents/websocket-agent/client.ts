import WebSocket from 'ws';

import { A2AWebSocket, WebSocketFactory, WebSocketTransport } from '../../../client/index.js';
import { A2A_PROTOCOL_VERSION, Role } from '../../../index.js';
import { SendMessageRequest } from '../../../types/pb/a2a.js';

const AGENT_URL = process.env.AGENT_URL || 'ws://localhost:41241/a2a/ws';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'a2a-websocket-example-token';
const ORIGIN = process.env.ORIGIN || 'http://localhost:41241';

const nodeWebSocketFactory: WebSocketFactory = (endpoint, protocols, options) => {
  const socket = new WebSocket(endpoint, protocols, {
    headers: {
      ...options.headers,
      Origin: ORIGIN,
    },
  });

  const adaptedSocket: A2AWebSocket = {
    get readyState() {
      return socket.readyState;
    },
    send(data: string) {
      socket.send(data);
    },
    close(code?: number, reason?: string) {
      socket.close(code, reason);
    },
    addEventListener(type, listener) {
      switch (type) {
        case 'open':
          socket.on('open', () => listener({}));
          break;
        case 'message':
          socket.on('message', (data) => listener({ data: data.toString() }));
          break;
        case 'error':
          socket.on('error', (error) => listener({ data: error }));
          break;
        case 'close':
          socket.on('close', (code, reason) => listener({ code, reason: reason.toString() }));
          break;
        default:
          throw new Error(`Unsupported WebSocket event: ${type}`);
      }
    },
  };

  return adaptedSocket;
};

function createMessage(text: string): SendMessageRequest {
  return {
    tenant: '',
    metadata: {},
    message: {
      messageId: crypto.randomUUID(),
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: 'text', value: text },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        },
      ],
      taskId: '',
      contextId: 'websocket-example-context',
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ['text/plain'],
      taskPushNotificationConfig: undefined,
      returnImmediately: false,
    },
  };
}

function describeEvent(event: { payload?: { $case: string; value: unknown } } | undefined): string {
  return event?.payload?.$case || 'unknown';
}

async function main(): Promise<void> {
  const transport = new WebSocketTransport({
    endpoint: AGENT_URL,
    webSocketFactory: nodeWebSocketFactory,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'A2A-Version': A2A_PROTOCOL_VERSION,
      'X-A2A-User': 'websocket-example-client',
    },
  });

  await transport.connect();
  console.log(`[WebSocketClient] Connected to ${AGENT_URL}`);

  const stream = transport.sendMessageStream(
    createMessage('Stream a response while I send another request.')
  );
  const firstEvent = await stream.next();
  if (firstEvent.done) {
    throw new Error('The agent closed the stream without sending a response');
  }
  console.log(`[WebSocketClient] Stream event: ${describeEvent(firstEvent.value)}`);

  console.log('[WebSocketClient] Sending a unary request while the stream is active');
  const unaryResponse = transport.sendMessage(createMessage('This request shares the socket.'));

  for await (const event of stream) {
    console.log(`[WebSocketClient] Stream event: ${describeEvent(event)}`);
  }
  console.log('[WebSocketClient] Stream completed');

  const unaryResult = await unaryResponse;
  console.log(`[WebSocketClient] Unary response received: ${Object.keys(unaryResult)}`);

  await transport.destroy();
  console.log('[WebSocketClient] Connection closed');
}

main().catch((error: unknown) => {
  console.error('[WebSocketClient] Request failed:', error);
  process.exitCode = 1;
});

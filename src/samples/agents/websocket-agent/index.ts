import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { URL } from 'node:url';

import express from 'express';
import { WebSocketServer } from 'ws';

import { A2A_PROTOCOL_VERSION, AGENT_CARD_PATH, AgentCard } from '../../../index.js';
import {
  adaptWebSocketConnection,
  AgentExecutor,
  DefaultRequestHandler,
  InMemoryTaskStore,
  TaskStore,
  User,
  WebSocketTransportHandler,
  type WebSocketSocketLike,
} from '../../../server/index.js';
import { agentCardHandler } from '../../../server/express/index.js';
import { SampleAgentExecutor } from '../sample-agent/agent_executor.js';

const PORT = Number(process.env.PORT || 41241);
const WEBSOCKET_PATH = process.env.WEBSOCKET_PATH || '/a2a/ws';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'a2a-websocket-example-token';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || `http://localhost:${PORT}`;

const websocketAgentCard: AgentCard = {
  name: 'Sample WebSocket Agent',
  description:
    'A streaming A2A agent exposed over a persistent, authenticated WebSocket connection.',
  supportedInterfaces: [
    {
      url: `ws://localhost:${PORT}${WEBSOCKET_PATH}`,
      protocolBinding: 'WEBSOCKET',
      tenant: '',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
  ],
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples',
  },
  version: '1.0.0',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    extensions: [],
    extendedAgentCard: false,
  },
  securityRequirements: [{ schemes: { Bearer: { list: [] } } }],
  securitySchemes: {
    Bearer: {
      scheme: {
        $case: 'httpAuthSecurityScheme',
        value: {
          description: 'Bearer token required during the WebSocket handshake.',
          scheme: 'bearer',
          bearerFormat: 'opaque token',
        },
      },
    },
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'],
  skills: [
    {
      id: 'websocket_streaming',
      name: 'WebSocket streaming',
      description: 'Streams task updates while accepting other requests on the same socket.',
      tags: ['websocket', 'streaming', 'multiplexing'],
      examples: ['Stream a response over WebSocket.'],
      inputModes: ['text'],
      outputModes: ['text', 'task-status'],
      securityRequirements: [],
    },
  ],
  documentationUrl: '',
  signatures: [],
};

class AuthenticatedUser implements User {
  public readonly isAuthenticated = true;

  constructor(public readonly userName: string) {}
}

function isAuthorized(request: IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${ACCESS_TOKEN}`;
}

function hasSupportedProtocol(request: IncomingMessage): boolean {
  const header = request.headers['sec-websocket-protocol'];
  const protocols = Array.isArray(header) ? header : header?.split(',');
  return protocols?.some((protocol) => protocol.trim() === 'a2a.v1') ?? false;
}

function isAllowedOrigin(request: IncomingMessage): boolean {
  return request.headers.origin === ALLOWED_ORIGIN;
}

function rejectUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function main(): Promise<void> {
  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new SampleAgentExecutor();
  const requestHandler = new DefaultRequestHandler(websocketAgentCard, taskStore, agentExecutor);

  const app = express();
  app.get('/', (_request, response) => {
    response.json({
      name: websocketAgentCard.name,
      websocket: `ws://localhost:${PORT}${WEBSOCKET_PATH}`,
      agentCard: `http://localhost:${PORT}/${AGENT_CARD_PATH}`,
    });
  });
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));

  const httpServer = createServer(app);
  const webSocketServer = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (requestUrl.pathname !== WEBSOCKET_PATH) {
      rejectUpgrade(socket, '404 Not Found');
      return;
    }
    if (!hasSupportedProtocol(request)) {
      rejectUpgrade(socket, '426 Upgrade Required');
      return;
    }
    if (!isAllowedOrigin(request)) {
      rejectUpgrade(socket, '403 Forbidden');
      return;
    }
    if (!isAuthorized(request)) {
      rejectUpgrade(socket, '401 Unauthorized');
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      const userNameHeader = request.headers['x-a2a-user'];
      const userName = Array.isArray(userNameHeader)
        ? userNameHeader[0]
        : userNameHeader || 'websocket-client';
      const transportHandler = new WebSocketTransportHandler(requestHandler, {
        handshake: {
          headers: request.headers,
          user: new AuthenticatedUser(userName),
          serviceParameters: {
            'a2a-version': A2A_PROTOCOL_VERSION,
          },
        },
      });
      transportHandler.handleConnection(adaptWebSocketConnection(webSocket as WebSocketSocketLike));
      console.log(`[WebSocketAgent] Accepted authenticated connection for ${userName}`);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(PORT, resolve);
  });

  console.log(`[WebSocketAgent] Server started on http://localhost:${PORT}`);
  console.log(`[WebSocketAgent] Agent Card: http://localhost:${PORT}/${AGENT_CARD_PATH}`);
  console.log(`[WebSocketAgent] WebSocket: ws://localhost:${PORT}${WEBSOCKET_PATH}`);
  console.log(`[WebSocketAgent] Allowed Origin: ${ALLOWED_ORIGIN}`);
  console.log('[WebSocketAgent] Press Ctrl+C to stop the server');
}

main().catch((error: unknown) => {
  console.error('[WebSocketAgent] Server failed to start:', error);
  process.exitCode = 1;
});

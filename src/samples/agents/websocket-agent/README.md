# WebSocket Agent

This sample exposes a streaming A2A agent over the SDK's WebSocket binding and
includes a Node.js client for exercising it.

The server demonstrates the host responsibilities that sit around the SDK
transport handler:

- publishing a WebSocket interface in the Agent Card, with `protocolBinding`
  set to the experimental binding URI
  `https://a2a-protocol.org/bindings/experimental-websocket/v1`
  (`WEBSOCKET_PROTOCOL_NAME`);
- negotiating the `a2a.v1` subprotocol during the HTTP Upgrade;
- validating the request `Origin` and Bearer token before accepting the socket;
- adapting a `ws` connection with `adaptWebSocketConnection`; and
- passing the authenticated connection, its headers and its request URL to
  `WebSocketTransportHandler`, which reads the connection's `A2A-Version`
  (header first, then query parameter, defaulting to `0.3`) and closes with
  `4002` when the Agent Card does not support it.

The client sets `protocolVersion`, which the transport sends as the
`A2A-Version` handshake header.

The client uses one persistent socket for a streaming `SendStreamingMessage`
and a concurrent unary `SendMessage`. The server can therefore send stream
events while receiving and answering another request on the same connection.

## Running

From `src/samples`:

```bash
npm install
npm run agents:websocket-agent
```

In a second terminal:

```bash
npm run agents:websocket-client
```

The server prints the Agent Card and WebSocket URLs. The client prints each
stream event, then confirms that the concurrent unary response arrived before
closing the connection.

## Configuration

| Variable         | Default                       | Description                                    |
| ---------------- | ----------------------------- | ---------------------------------------------- |
| `PORT`           | `41241`                       | HTTP and WebSocket server port                 |
| `WEBSOCKET_PATH` | `/a2a/ws`                     | WebSocket upgrade path                         |
| `ACCESS_TOKEN`   | `a2a-websocket-example-token` | Bearer token required by the server and client |
| `ALLOWED_ORIGIN` | `http://localhost:41241`      | Origin accepted during the WebSocket handshake |
| `AGENT_URL`      | `ws://localhost:41241/a2a/ws` | WebSocket endpoint used by the client          |
| `ORIGIN`         | `http://localhost:41241`      | Origin sent by the client                      |

This is an intentionally small local example. In a deployed service, use
`wss://`, TLS termination, a real token verifier, and an explicit origin allow
list rather than the development defaults above.

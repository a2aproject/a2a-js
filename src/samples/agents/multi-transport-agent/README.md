# Multi-Transport Agent

This sample exposes a single A2A agent over **all three transports supported by
the SDK simultaneously**:

| Transport      | URL                                                                         |
| -------------- | --------------------------------------------------------------------------- |
| JSON-RPC       | `http://localhost:41241/a2a/jsonrpc`                                        |
| HTTP+JSON/REST | `http://localhost:41241/a2a/rest` (then `<operation>`, e.g. `message:send`) |
| gRPC           | `localhost:41242`                                                           |
| Agent Card     | `http://localhost:41241/.well-known/agent-card.json`                        |

The same `DefaultRequestHandler` instance backs every transport, so the
business logic is written exactly once. The agent card declares all three
interfaces in `supportedInterfaces`, allowing
[`ClientFactory`](../../../client/factory.ts) to pick whichever transport the
client prefers.

## Running

```bash
npm run agents:multi-transport-agent
```

You should see:

```
[MultiTransportAgent] HTTP server started on http://localhost:41241
  JSON-RPC : http://localhost:41241/a2a/jsonrpc
  REST     : http://localhost:41241/a2a/rest
  Card     : http://localhost:41241/.well-known/agent-card.json
[MultiTransportAgent] gRPC server started on localhost:41242
```

## Talking to the agent

### Using the bundled CLI (auto-discovery)

The `cli.ts` sample inspects the agent card and picks the first matching
transport. Force a specific one with `--transport=`:

```bash
# JSON-RPC (default preference order)
npm run a2a:cli http://localhost:41241

# REST
npm run a2a:cli http://localhost:41241 -- --transport=HTTP+JSON

# gRPC
npm run a2a:cli http://localhost:41241 -- --transport=GRPC
```

### Direct REST request

REST routes are exposed by the SDK's
[`restHandler`](../../../server/express/rest_handler.ts) at the operation
paths defined in
[A2A Specification §11.3 (URL Patterns and HTTP Methods)](https://a2a-protocol.org/latest/specification/#113-url-patterns-and-http-methods)
— for example `POST /message:send`, `POST /message:stream`,
`GET /tasks/{id}`, `POST /tasks/{id}:cancel`. There is no version prefix:
mounting `restHandler` at `/a2a/rest` therefore yields full paths such as
`/a2a/rest/message:send`. The body is the JSON wire form of
`SendMessageRequest`. REST returns the bare result object — there is no
JSON-RPC envelope. The `A2A-Version` header is required; if it is omitted
the binding defaults to `0.3` and the agent rejects the request with
`VERSION_NOT_SUPPORTED`.

```bash
curl -sS -X POST http://localhost:41241/a2a/rest/message:send \
  -H 'Content-Type: application/json' \
  -H 'A2A-Version: 1.0' \
  -d '{
    "message": {
      "messageId": "demo-1",
      "role": "ROLE_USER",
      "parts": [{ "text": "hello", "mediaType": "text/plain" }]
    }
  }'
```

### Direct JSON-RPC request

```bash
curl -sS -X POST http://localhost:41241/a2a/jsonrpc \
  -H 'Content-Type: application/json' \
  -H 'A2A-Version: 1.0' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "SendMessage",
    "params": {
      "message": {
        "messageId": "demo-2",
        "role": "ROLE_USER",
        "parts": [{ "text": "hello", "mediaType": "text/plain" }]
      }
    }
  }'
```

## Configuration

| Variable    | Default | Description                 |
| ----------- | ------- | --------------------------- |
| `HTTP_PORT` | `41241` | JSON-RPC + REST + AgentCard |
| `GRPC_PORT` | `41242` | gRPC service                |

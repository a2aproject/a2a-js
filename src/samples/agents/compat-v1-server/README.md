# Compat v1.0 Server

A v1.0-native A2A server that accepts BOTH modern (v1.0) and legacy (v0.3) clients
on the **same URLs**, across **all three transports**. Each binding is declared
twice in `supportedInterfaces` — once at v1.0 and once at v0.3 — via the
`duplicateInterfacesForLegacy` helper.

This is the server half of a two-part showcase of the `@a2a-js/sdk` v0.3 compat
layer; the client half lives next to it under
[`../compat-v1-client/`](../compat-v1-client/). See
[`src/compat/v0_3/README.md`](../../../compat/v0_3/README.md) for the underlying
architecture (translators, header dispatch, hybrid agent card embedding).

## What the sample demonstrates

| Surface             | URL                                                     | Accepts v1.0?      | Accepts v0.3?                              |
| ------------------- | ------------------------------------------------------- | ------------------ | ------------------------------------------ |
| Agent card          | `http://localhost:41251/.well-known/agent-card.json`    | yes (modern shape) | yes (hybrid shape, default when no header) |
| JSON-RPC            | `http://localhost:41251/a2a/jsonrpc`                    | yes                | yes (body-shape detection)                 |
| REST (v1.0)         | `http://localhost:41251/a2a/rest/<operation>`           | yes                | n/a (different paths)                      |
| REST (v0.3)         | `http://localhost:41251/a2a/rest/v1/<operation>`        | n/a (404)          | yes                                        |
| gRPC                | `localhost:41252`                                       | yes (`A2AService`) | yes (`LegacyA2AService`)                   |
| Push notifications  | Per-webhook (registered via any of the above)           | yes (`application/a2a+json` `StreamResponse`) | yes (`application/json` bare event) |

A single `DefaultRequestHandler` backs every transport AND every version — the
business logic only ever sees v1.0 types; the compat layer translates v0.3 wire
shapes to v1.0 (and back) transparently.

For push notifications, the server wires `createLegacyAwarePushNotificationSender`
from `@a2a-js/sdk/compat/v0_3/server`, which pre-registers a
`V03PushNotificationSerializer` alongside the built-in `V1PushNotificationSerializer`.
The `InMemoryPushNotificationStore` captures `context.requestedVersion` at
registration time, so each webhook keeps receiving the wire shape it was
originally registered with — v0.3 and v1.0 webhooks coexist on the SAME task.

## Running

```bash
npm run agents:compat-v1-server
```

You should see:

```
[CompatServer] HTTP server started on http://localhost:41251
  JSON-RPC : http://localhost:41251/a2a/jsonrpc  (v1.0 + v0.3)
  REST v1.0: http://localhost:41251/a2a/rest/message:send  (and other `/<operation>` routes)
  REST v0.3: http://localhost:41251/a2a/rest/v1/message:send  (and other `/v1/...` routes)
  Card     : http://localhost:41251/.well-known/agent-card.json  (hybrid: shape depends on A2A-Version header)
  Push     : v1.0 webhooks receive application/a2a+json StreamResponse envelopes
             v0.3 webhooks receive application/json     bare-event bodies
[CompatServer] gRPC server started on localhost:41252  (v1.0 + v0.3)
```

## Talking to the server

### Agent card: hybrid response

```bash
# v0.3 client (or any client that omits `A2A-Version`, which §3.6.2 defaults to '0.3'):
curl -sS http://localhost:41251/.well-known/agent-card.json | jq

# Response includes v0.3 top-level fields (`url`, `preferredTransport`,
# `additionalInterfaces`, `protocolVersion: "0.3"`) AND the original v1.0
# `supportedInterfaces[]` array (the hybrid embedding). Either kind of
# resolver can discover the same agent without operator-side duplication.
```

```bash
# v1.0 client: receives the modern proto-JSON card unchanged.
curl -sS -H 'A2A-Version: 1.0' http://localhost:41251/.well-known/agent-card.json | jq
```

`Vary: A2A-Version` is set on every response so shared HTTP caches keep separate
entries per version.

### JSON-RPC: same endpoint, both wire shapes

```bash
# v0.3 (legacy) JSON-RPC: method names are kebab-style, parts use the `kind` discriminator.
curl -sS -X POST http://localhost:41251/a2a/jsonrpc \
  -H 'Content-Type: application/json' \
  -H 'A2A-Version: 0.3' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "messageId": "demo-v03",
        "role": "user",
        "parts": [{ "kind": "text", "text": "hello" }]
      }
    }
  }'
```

```bash
# v1.0 JSON-RPC: method names are PascalCase, parts use the `oneof content` shape.
curl -sS -X POST http://localhost:41251/a2a/jsonrpc \
  -H 'Content-Type: application/json' \
  -H 'A2A-Version: 1.0' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "SendMessage",
    "params": {
      "message": {
        "messageId": "demo-v10",
        "role": "ROLE_USER",
        "parts": [{ "text": "hello", "mediaType": "text/plain" }]
      }
    }
  }'
```

### REST: disjoint paths

The v0.3 reference REST surface (`/v1/...`) and the v1.0 REST surface
(`/<operation>` per spec §11.3) coexist under the same mount point.

**Both** REST surfaces speak **proto-JSON** of their respective proto types
(per each version's `google.api.http` annotations), NOT the JSON-Schema-style
bodies with `kind:` discriminators that you'd send over v0.3 JSON-RPC. This
matches the cross-SDK convention. The v0.3 and v1.0 REST bodies look very similar
on the wire — the differences are field renames and the response `Content-Type` header:

| Aspect              | v0.3 REST                     | v1.0 REST                     |
| ------------------- | ----------------------------- | ----------------------------- |
| Path prefix         | `/v1/<operation>`             | `/<operation>` (no `/v1/`)    |
| Request field name  | `request` (a `Message`)       | `message` (a `Message`)       |
| `Message` payload   | `content[]`                   | `parts[]`                     |
| `role` encoding     | proto enum (`ROLE_USER`)      | proto enum (`ROLE_USER`)      |
| Response shape      | proto-JSON `SendMessageResponse` (`{task: {...}}` or `{msg: {...}}` oneof) | proto-JSON `SendMessageResponse` (same shape) |
| Response `Content-Type` | `application/json`        | `application/a2a+json`        |
| Response `state` enum | `TASK_STATE_COMPLETED`      | `TASK_STATE_COMPLETED`        |

```bash
# v0.3 REST: per the v0.3 a2a.proto google.api.http annotations.
# Body is proto-JSON `SendMessageRequest` (the v0.3 proto's Message has
# `content[]` instead of v1.0's `parts[]`, and the outer field is
# `request` instead of `message`).
curl -sS -X POST http://localhost:41251/a2a/rest/v1/message:send \
  -H 'Content-Type: application/json' \
  -H 'A2A-Version: 0.3' \
  -d '{
    "request": {
      "messageId": "demo-rest-v03",
      "role": "ROLE_USER",
      "content": [{ "text": "hello", "mediaType": "text/plain" }]
    }
  }'
```

```bash
# v1.0 REST: bare proto-JSON `SendMessageRequest`, no JSON-RPC envelope.
curl -sS -X POST http://localhost:41251/a2a/rest/message:send \
  -H 'Content-Type: application/json' \
  -H 'A2A-Version: 1.0' \
  -d '{
    "message": {
      "messageId": "demo-rest-v10",
      "role": "ROLE_USER",
      "parts": [{ "text": "hello", "mediaType": "text/plain" }]
    }
  }'
```

If you want a v0.3 wire shape with JSON-Schema-style `{kind: 'task', state:
'completed', parts: [{kind: 'text', ...}]}` envelopes, use the v0.3 JSON-RPC
endpoint (`/a2a/jsonrpc` above) — that's the surface that emits and accepts
the JSON-Schema spec types verbatim.

```bash
# v1.0 REST: bare proto-JSON `SendMessageRequest`, no JSON-RPC envelope.
curl -sS -X POST http://localhost:41251/a2a/rest/message:send \
  -H 'Content-Type: application/json' \
  -H 'A2A-Version: 1.0' \
  -d '{
    "message": {
      "messageId": "demo-rest-v10",
      "role": "ROLE_USER",
      "parts": [{ "text": "hello", "mediaType": "text/plain" }]
    }
  }'
```

### gRPC: two services on one port

Use `grpcurl` (or any v0.3 / v1.0 gRPC client) against `localhost:41252`. The
v1.0 service is named `a2a.v1.A2AService`; the v0.3 service is named
`a2a.v1.A2AService` in its own descriptor (the proto-package names overlap by
spec — they're discriminated by descriptor, not by name). The companion
[`../compat-v1-client/`](../compat-v1-client/) sample exercises both via the
SDK's gRPC transport factory.

## Talking to the server with the bundled CLI

The CLI at `samples/cli.ts` is a v1.0-native client. It Just Works against this
server because the v1.0 surface is unchanged:

```bash
# Auto-discovers from the agent card and picks the first matching transport.
npm run a2a:cli http://localhost:41251

# Force a specific transport:
npm run a2a:cli http://localhost:41251 -- --transport=HTTP+JSON
npm run a2a:cli http://localhost:41251 -- --transport=GRPC
```

To drive the legacy paths from a real SDK client, run the companion
[`compat-v1-client`](../compat-v1-client/) sample, which uses
`legacyCompat: { enabled: true }` on every transport factory.

## Configuration

| Variable    | Default | Description                 |
| ----------- | ------- | --------------------------- |
| `HTTP_PORT` | `41251` | JSON-RPC + REST + AgentCard |
| `GRPC_PORT` | `41252` | gRPC service                |

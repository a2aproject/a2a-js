# Compat v1.0 Client

A v1.0-native A2A client that talks to BOTH modern (v1.0) and legacy (v0.3)
servers using the SDK's standard public API. The only "compat" thing about
the client is `legacyCompat: { enabled: true }` set on each transport factory
and on the card resolver — everything else is plain `ClientFactory` /
`Client` / `sendMessageStream` / `sendMessage`.

This is the client half of a two-part showcase; see
[`../compat-v1-server/`](../compat-v1-server/) for the server half and
[`src/compat/v0_3/README.md`](../../../compat/v0_3/README.md) for the
architecture notes.

## What the sample does

Five connections back-to-back from a single linear flow:

1. **v1.0+compat server, JSON-RPC.** Expect `JsonRpcTransport` / `1.0`. The
   server's hybrid card carries `supportedInterfaces[]`, so the resolver
   picks v1.0 even though `legacyCompat` is enabled — no downgrade dance.
2. **Mock v0.3 server, JSON-RPC.** Expect `LegacyJsonRpcTransport` / `0.3`.
   The mock's card is pure v0.3 (no `supportedInterfaces[]`); the resolver
   detects v0.3 by response shape and the `JsonRpcTransportFactory`
   dispatches to its v0.3 transport automatically.
3. **v1.0+compat server, gRPC.** Expect `GrpcTransport` / `1.0`.
4. **Push notification → v1.0+compat server.** Webhook body is the v1.0
   `StreamResponse` envelope, `Content-Type: application/a2a+json`.
5. **Push notification → mock v0.3 server.** Webhook body is a bare v0.3
   event with inner `kind:` discriminator, `Content-Type: application/json`.
   Same client API as step 4; the wire-shape difference comes from the peer.

## About the mock v0.3 server

The driver spins up an in-process mock v0.3 server (`_mock-v0_3-server.ts`)
purely so this demo runs without needing an external v0.3 peer.

**The mock is hand-rolled.** Every wire response is a literal JSON template
following the v0.3 spec verbatim. It does **not** import anything from
`@a2a-js/sdk/compat/v0_3/server` — those modules exist exclusively to teach
the SDK's v1.0 server how to TOLERATE v0.3 traffic, and are NOT the public
API for building a v0.3 server.

Read the file to see exactly what v0.3 wire bytes look like, side-by-side
with the client's logged output. **Do not** copy it as a "v0.3 server
template" — it implements only the few JSON-RPC methods this demo needs and
only the happy-path branches. A real v0.3 server should be built either by
implementing the spec directly (https://a2a-protocol.org/v0_3/specification/)
or by using the SDK's v1.0 server with `legacyCompat: { enabled: true }`
on each handler (see [`../compat-v1-server/`](../compat-v1-server/)) — which
gives production-grade v0.3 support for free.

## Running

In one terminal, start the compat server:

```bash
npm run agents:compat-v1-server
```

In another terminal, run the client:

```bash
npm run agents:compat-v1-client
```

The driver spawns its own in-process mock v0.3 server (port `41253`) and
webhook receiver (port `42424`), so no extra setup is needed.

Expected output (abbreviated):

```
[Client] === v1.0+compat server, JSON-RPC ===
[Client] compat-aware → v1.0 server: transport=JsonRpcTransport version=1.0
...

[Client] === Mock v0.3 server, JSON-RPC ===
[Client] compat-aware → mock v0.3 server: transport=LegacyJsonRpcTransport version=0.3
...

[Client] === v1.0+compat server, gRPC ===
[Client] compat-aware → v1.0 server (gRPC): transport=GrpcTransport version=1.0
...

[Client] === Push notification → v1.0+compat server ===
[Webhook] Captured 4 webhook(s) for task ...:
[Webhook]   Content-Type: application/a2a+json ✓
[Webhook]   Body summary: v1.0 StreamResponse{task}
...

[Client] === Push notification → mock v0.3 server ===
[Webhook] Captured 4 webhook(s) for task ...:
[Webhook]   Content-Type: application/json ✓
[Webhook]   Body summary: v0.3 bare event{kind: 'task'}
...

[Client] Done.
```

## How it's wired

Every connection uses the same factory:

```ts
const factory = new ClientFactory(
  ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    cardResolver: new DefaultAgentCardResolver({ legacyCompat: { enabled: true } }),
    transports: [
      new JsonRpcTransportFactory({ legacyCompat: { enabled: true } }),
      new RestTransportFactory({ legacyCompat: { enabled: true } }),
      new GrpcTransportFactory({ legacyCompat: { enabled: true } }),
    ],
  })
);

const client = await factory.createFromUrl(serverUrl);
// → talks v1.0 to v1.0 peers, v0.3 to v0.3 peers, automatically
```

`ClientFactory` itself doesn't take a `legacyCompat` option — the opt-in is
per transport factory and per resolver. This mirrors the server side, where
each Express handler (`jsonRpcHandler`, `restHandler`, `agentCardHandler`)
takes its own `legacyCompat` opt-in.

When `legacyCompat: { enabled: true }` is set:

1. **`DefaultAgentCardResolver`** inspects every fetched card. If the
   response shape matches v0.3 (top-level `url` without
   `supportedInterfaces`, `preferredTransport`, `additionalInterfaces`, or a
   `protocolVersion` in the `[0.3, 1.0)` range), it translates the card to a
   v1.0 representation with `protocolVersion: '0.3'` stamped on every
   synthesized `AgentInterface`. A "hybrid" card with BOTH v0.3 top-level
   fields AND v1.0 `supportedInterfaces[]` is treated as v1.0 — that's the
   override that prevents the downgrade dance in step 1.

2. Each transport factory's `create()` method inspects the matched
   `AgentInterface.protocolVersion`. If it falls in `[0.3, 1.0)`, the
   factory produces the v0.3 compat transport instead of the native v1.0
   transport.

3. The v0.3 compat transport class is only instantiated when
   `legacyCompat: { enabled: true }` is set on the factory and the matched
   interface speaks v0.3 — so factories with the flag off never construct
   a legacy transport at runtime.

For push notifications, the v1.0+compat server uses
`createLegacyAwarePushNotificationSender`, which pre-registers BOTH the
v1.0 and v0.3 serializers and dispatches per-webhook based on the
`requestedVersion` captured at registration time. Steps 4 and 5 show this
working: v1.0 webhooks get v1.0 wire bodies, v0.3 webhooks get v0.3 wire
bodies — same server, same store, same sender.

## Configuration

| Variable           | Default | Description                              |
| ------------------ | ------- | ---------------------------------------- |
| `COMPAT_HTTP_PORT` | `41251` | HTTP port of the v1.0+compat server      |
| `COMPAT_GRPC_PORT` | `41252` | gRPC port of the v1.0+compat server      |
| `MOCK_V03_PORT`    | `41253` | Port for the in-process mock v0.3 server |
| `WEBHOOK_PORT`     | `42424` | Port for the in-process webhook receiver |

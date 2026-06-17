# Compat v1.0 Client

A v1.0-native A2A client that talks to BOTH modern (v1.0) and legacy (v0.3)
servers, demonstrating the client side of the `@a2a-js/sdk` v0.3 compat layer.

This is the client half of a two-part showcase; see
[`../compat-v1-server/`](../compat-v1-server/) for the server half and
[`src/compat/v0_3/README.md`](../../../compat/v0_3/README.md) for the
architecture notes.

## What the sample does

The driver runs five connections back-to-back from a single linear flow:

1. **Compat-aware v1.0 client → compat server (JSON-RPC).** Confirms that
   opting into `legacyCompat` on the client does NOT downgrade the wire to
   v0.3 when the server speaks v1.0 — the hybrid card's embedded
   `supportedInterfaces[]` is preferred. Expect `JsonRpcTransport` / `1.0`.
2. **Same client wiring → in-process pure-v0.3 server (JSON-RPC).** The
   legacy card has no embedded v1.0 interfaces; the resolver detects v0.3 by
   response shape, stamps `protocolVersion: '0.3'` on every synthesized
   interface, and the factory dispatches to `LegacyJsonRpcTransport`. Expect
   `LegacyJsonRpcTransport` / `0.3`.
3. **Compat-aware v1.0 client → compat server over gRPC.** Same
   compat-dispatch logic on a different transport. Expect `GrpcTransport` /
   `1.0`.
4. **v1.0 push notification → compat server.** Registers a webhook via the
   v1.0 JSON-RPC transport. The server's
   `createLegacyAwarePushNotificationSender` picks the
   `V1PushNotificationSerializer` because the registration context carries
   `requestedVersion: '1.0'`. The in-process webhook receiver shows
   `Content-Type: application/a2a+json` and bodies wrapped in
   `StreamResponse{<key>}` envelopes.
5. **v0.3 push notification → SAME compat server.** Forces the v0.3 wire
   path by handing the factory a synthetic v0.3-only `AgentCard` pointing at
   the compat server's URL (the `JsonRpcTransportFactory` sees
   `protocolVersion: '0.3'` on the matched interface and dispatches to
   `LegacyJsonRpcTransport`). The same sender on the same server, with the
   same store, now picks the `V03PushNotificationSerializer` for this
   webhook because the registration context carries `requestedVersion: '0.3'`.
   The receiver shows `Content-Type: application/json` and bare v0.3 events
   with `kind: '...'` inner discriminators.

Each connection runs a real `sendMessageStream` (steps 1-3) or `sendMessage`
+ webhook capture (steps 4-5) round-trip so the wire path is exercised
end-to-end, not just the wiring.

## Running

In one terminal, start the compat server:

```bash
npm run agents:compat-v1-server
```

In another terminal, run the client driver:

```bash
npm run agents:compat-v1-client
```

The driver spawns its own in-process pure-v0.3 server (port `41253`) and
webhook receiver (port `42424`), so no extra setup is needed.

Expected output (abbreviated):

```
[Client] Compat server:    http://localhost:41251 (HTTP) / localhost:41252 (gRPC)
[Client] Pure-v0.3 server: http://localhost:41253 (in-process)
[Client] Webhook receiver: http://localhost:42424/webhook/task-updates (in-process)

[Client] === Connecting to compat server over HTTP (JSON-RPC) ===
[Client] compat-aware → compat server: transport=JsonRpcTransport version=1.0
[Client] task           id=... state=TASK_STATE_SUBMITTED
...
[Client] statusUpdate   task=... state=TASK_STATE_COMPLETED

[Client] === Connecting to pure-v0.3 server over HTTP (JSON-RPC) ===
[Client] compat-aware → pure-v0.3 server: transport=LegacyJsonRpcTransport version=0.3
...

[Client] === Connecting to compat server over gRPC ===
[Client] compat-aware → compat server (gRPC): transport=GrpcTransport version=1.0
...

[Client] === v1.0 push notification → compat server ===
[Client] v1.0 push → compat server: transport=JsonRpcTransport version=1.0
[Client] sendMessage returned task id=... state=TASK_STATE_COMPLETED
[Webhook] Captured 4 webhook(s) for task ...:
[Webhook]   Content-Type: application/a2a+json ✓
[Webhook]   Body summary: v1.0 StreamResponse{task}
[Webhook]   Content-Type: application/a2a+json ✓
[Webhook]   Body summary: v1.0 StreamResponse{statusUpdate}
[Webhook]   Content-Type: application/a2a+json ✓
[Webhook]   Body summary: v1.0 StreamResponse{artifactUpdate}
[Webhook]   Content-Type: application/a2a+json ✓
[Webhook]   Body summary: v1.0 StreamResponse{statusUpdate}

[Client] === v0.3 push notification → compat server (same server!) ===
[Client] v0.3 push → compat server: transport=LegacyJsonRpcTransport version=0.3
[Client] sendMessage returned task id=... state=TASK_STATE_COMPLETED
[Webhook] Captured 4 webhook(s) for task ...:
[Webhook]   Content-Type: application/json ✓
[Webhook]   Body summary: v0.3 bare event{kind: 'task'}
[Webhook]   Content-Type: application/json ✓
[Webhook]   Body summary: v0.3 bare event{kind: 'status-update'}
[Webhook]   Content-Type: application/json ✓
[Webhook]   Body summary: v0.3 bare event{kind: 'artifact-update'}
[Webhook]   Content-Type: application/json ✓
[Webhook]   Body summary: v0.3 bare event{kind: 'status-update'}

[Client] Done.
```

## How it's wired

### Client side: per-factory `legacyCompat` opt-in

The factory used for the first three connections sets
`legacyCompat: { enabled: true }` on EVERY transport factory AND on the card
resolver:

```ts
const factory = new ClientFactory(
  ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    cardResolver: new DefaultAgentCardResolver({ legacyCompat: { enabled: true } }),
    transports: [
      new JsonRpcTransportFactory({ legacyCompat: { enabled: true } }),
      new RestTransportFactory({   legacyCompat: { enabled: true } }),
      new GrpcTransportFactory({   legacyCompat: { enabled: true } }),
    ],
  })
);
```

Note that `ClientFactory` itself doesn't take a `legacyCompat` option — the
opt-in is per transport factory and per resolver. This mirrors the server
side, where each Express handler (`jsonRpcHandler`, `restHandler`,
`agentCardHandler`) takes its own `legacyCompat` opt-in.

When `legacyCompat: { enabled: true }` is set:

1. The `DefaultAgentCardResolver` inspects every fetched card. If the response
   shape matches v0.3 (top-level `url` without `supportedInterfaces`,
   `preferredTransport`, `additionalInterfaces`, or `protocolVersion` in the
   `[0.3, 1.0)` range), it translates the card to a v1.0 representation with
   `protocolVersion: '0.3'` stamped on every synthesized `AgentInterface`.

   A "hybrid" card (one with BOTH v0.3 top-level fields AND an embedded v1.0
   `supportedInterfaces[]`) is treated as v1.0 — that's the override that
   prevents the downgrade dance in the first connection.

2. Each transport factory's `create()` method inspects the matched
   `AgentInterface.protocolVersion`. If it falls in `[0.3, 1.0)`, the factory
   produces the v0.3 compat transport (`LegacyJsonRpcTransport`,
   `LegacyRestTransport`, or `LegacyGrpcTransport`) instead of the native
   v1.0 transport. Otherwise it produces the v1.0 transport as usual.

3. The v0.3 compat module is lazy-loaded — it's never reached on the dispatch
   path when `legacyCompat` is not enabled.

### Forcing the v0.3 wire path against a v1.0-primary server (step 5)

The compat server's well-known card lists v1.0 interfaces first, so the
resolver normally picks v1.0. To exercise the v0.3 push-notification path
against the SAME server, the driver bypasses discovery and hands the factory
a synthetic v0.3-only `AgentCard`:

```ts
const v03Card: AgentCard = {
  ...,
  supportedInterfaces: [
    {
      url: 'http://localhost:41251/a2a/jsonrpc',
      protocolBinding: 'JSONRPC',
      protocolVersion: A2A_LEGACY_PROTOCOL_VERSION,  // '0.3'
    },
  ],
};
const client = await factory.createFromAgentCard(v03Card);
// client.transport is LegacyJsonRpcTransport, client.protocolVersion is '0.3'
```

This is a useful pattern in its own right — anywhere you need to force a
specific transport-version pair against a multi-version server.

### Server side: one sender, two serializers

The compat server uses `createLegacyAwarePushNotificationSender` from
`@a2a-js/sdk/compat/v0_3/server`, which returns a canonical
`DefaultPushNotificationSender` pre-registered with:

- `V1PushNotificationSerializer` for `'1.0'` → `application/a2a+json` body,
  v1.0 `StreamResponse` envelope (`{ task: {...} }` / `{ statusUpdate: {...} }` / ...).
- `V03PushNotificationSerializer` for `'0.3'` → `application/json` body,
  bare v0.3 event (`{ kind: 'task', id: '...', ... }` etc.).

The `InMemoryPushNotificationStore` captures `context.requestedVersion` at
registration time. When the sender later dispatches a webhook for a task,
it looks up the wire version that was active when the webhook was registered
and routes through the matching serializer. That's why webhooks registered
over v0.3 keep receiving v0.3-shaped bodies even when later events on the
same task are triggered by v1.0 requests — and vice versa.

## Configuration

| Variable           | Default | Description                                  |
| ------------------ | ------- | -------------------------------------------- |
| `COMPAT_HTTP_PORT` | `41251` | HTTP port of the compat server               |
| `COMPAT_GRPC_PORT` | `41252` | gRPC port of the compat server               |
| `V03_ONLY_PORT`    | `41253` | Port for the in-process pure-v0.3 fixture    |
| `WEBHOOK_PORT`     | `42424` | Port for the in-process webhook receiver     |

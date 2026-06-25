# v0.3 Compatibility Guide

`@a2a-js/sdk` 1.0 implements the **A2A Protocol Specification v1.0**, but
ships an opt-in compatibility layer so that v1.0 deployments can interoperate
with peers still on v0.3. The compat layer is the migration bridge: it lets
operators deploy v1.0 on either side of the wire ahead of the other side,
without forcing every client (or every server) to upgrade in lockstep.

This guide is written for **end users** of the SDK — server operators
deciding whether to turn the compat layer on, and client developers who need
to talk to peers that haven't migrated yet. For the architecture-level
walkthrough (translators, version negotiation internals, card synthesis
algorithm), see [`src/compat/v0_3/README.md`](../src/compat/v0_3/README.md).
For the protocol-level definition of v0.3 vs. v1.0 differences, see
[Appendix A: Migration Guidance](https://a2a-protocol.org/v1.0.0/specification/#appendix-a-migration-legacy-compatibility)
in the spec.

## When to enable it

Turn `legacyCompat: { enabled: true }` on when **any of these** is true:

- You run a v1.0 server and need to keep accepting v0.3 clients during a
  staged client migration.
- You write a v1.0 client and one or more of the agents it talks to still
  advertises v0.3 in its agent card.
- You're rolling out v1.0 across a fleet and want a single deployable artifact
  that handles both versions, instead of running parallel binaries.

Leave it off when:

- Every peer you talk to already speaks v1.0 (which keeps the v0.3 codepaths
  out of your dependency graph and out of your test matrix).
- You're building a brand-new v0.3-only system. The compat layer exists to
  teach v1.0 components how to **tolerate** v0.3 traffic; it is **not** a
  framework for building new v0.3 servers from scratch. (Build those against
  the [v0.3 spec](https://a2a-protocol.org/v0.3.0/specification/) directly.)

The opt-in is **per handler and per transport factory** — there's no
project-level switch. You can, for example, opt a JSON-RPC server in while
leaving REST strict.

## Published entry points

The compat layer is split into six subpath exports so each one carries only
the peer dependencies (`express`, `@grpc/grpc-js`) its runtime actually needs.
A Workers consumer that only needs the compat-aware JSON-RPC client transport
never pulls in Node-only modules.

| Subpath                                  | Use it for                                                                                                                              | Peer deps           |
| :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- | :------------------ |
| `@a2a-js/sdk/compat/v0_3`                | v0.3 protocol constants and method-name translators.                                                                                    | none (Workers-safe) |
| `@a2a-js/sdk/compat/v0_3/server`         | Framework-agnostic `LegacyJsonRpcTransportHandler`, `LegacyRestTransportHandler`, `createLegacyAwarePushNotificationSender`, serializer. | none (Workers-safe) |
| `@a2a-js/sdk/compat/v0_3/server/express` | Express routers (`legacyAgentCardRouter`, `legacyRestRouter`).                                                                          | `express`           |
| `@a2a-js/sdk/compat/v0_3/server/grpc`    | `legacyGrpcService` + `LegacyA2AService` descriptor.                                                                                    | `@grpc/grpc-js`     |
| `@a2a-js/sdk/compat/v0_3/client`         | `LegacyJsonRpcTransport`, `LegacyRestTransport`, plus `isLegacyAgentCard` / `parseLegacyAgentCard`.                                     | none (Workers-safe) |
| `@a2a-js/sdk/compat/v0_3/client/grpc`    | `LegacyGrpcTransport` (Node only; lazy-loaded by `GrpcTransportFactory`).                                                               | `@grpc/grpc-js`     |

The bidirectional v0.3 ↔ v1.0 translators in `src/compat/v0_3/translate/` are
intentionally internal and may change without a major-version bump.

---

## Server side: accepting v0.3 traffic on a v1.0 server

The v1.0 server handlers all expose a `legacyCompat` option. Set
`{ enabled: true }` on each handler whose transport should also accept
v0.3 traffic; the rest stay strict v1.0. Push notifications additionally
need `createLegacyAwarePushNotificationSender(...)` from
`@a2a-js/sdk/compat/v0_3/server` so v0.3-registered webhooks receive v0.3
bodies; gRPC needs `legacyGrpcService` from
`@a2a-js/sdk/compat/v0_3/server/grpc` bound next to `grpcService` (the v1.0
gRPC factory has no `legacyCompat` flag).

See the [`compat-v1-server`](../src/samples/agents/compat-v1-server/) sample
for the runnable wiring across all four surfaces (agent card, JSON-RPC, REST,
gRPC).

### How requests get routed

Once a handler is opted in, the routing is automatic — your `AgentExecutor`
never sees a v0.3 type. The compat layer translates incoming v0.3 wire bodies
into v1.0 proto types on the way in, and translates the v1.0 events your
executor publishes back into v0.3 shapes on the way out.

| Transport     | How v0.3 is detected                                                                                                                                                                                              |
| :------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON-RPC      | The handler inspects the JSON-RPC `method` name. Kebab-style names (`message/send`, `tasks/get`, …) route to the v0.3 dispatcher; PascalCase names (`SendMessage`, `GetTask`, …) route to the v1.0 dispatcher. |
| REST          | The v0.3 routes live under the `/v1/...` prefix (per the v0.3 reference proto's `google.api.http` annotations). v1.0 routes use `/<operation>` directly. Express's prefix matcher disambiguates without ambiguity. |
| gRPC          | Each version is a separate gRPC service descriptor (`A2AService` vs. `LegacyA2AService`). The transport picks the descriptor; the SDK never needs to sniff.                                                       |
| Agent card    | The handler reads the `A2A-Version` header (defaulting to `'0.3'` when absent, per spec §3.6.2) and emits the appropriate card shape, with `Vary: A2A-Version` set on the response.                                |

### Synthesized v0.3 agent card

When `legacyCompat` is enabled on `agentCardHandler`, you don't need to
duplicate every entry of `supportedInterfaces` with a v0.3 stub. The compat
layer:

1. Reads `validateVersion` with `{ legacyCompat: true }`, which adds the
   legacy `'0.3'` version to the supported set for any binding the card
   already exposes at least one interface for. v0.3 (and header-less)
   requests therefore route through the legacy handler chain even when the
   card declares only v1.0 interfaces.
2. Synthesizes a v0.3-shaped card on the well-known endpoint by setting
   `protocolVersion: '0.3'` on the same interface URLs the v1.0 card
   advertises. v0.3 clients can discover and use the agent transparently.

The card returned to a v0.3 client is a *hybrid*: it carries the v0.3
top-level fields (`url`, `preferredTransport`, `additionalInterfaces`) AND
keeps the v1.0 `supportedInterfaces[]` array embedded. A modern client that
encounters the hybrid card prefers `supportedInterfaces[]`, which prevents
unnecessary downgrades — see the `compat-v1-client` sample for the receiver
logic.

---

## Client side: talking to v0.3 servers from a v1.0 client

The client uses the same `legacyCompat: { enabled: true }` flag, set on each
transport factory and on the card resolver:

```ts
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from '@a2a-js/sdk/client';
import { GrpcTransportFactory } from '@a2a-js/sdk/client/grpc';

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

// Just works against either a v1.0 or a v0.3 server.
const client = await factory.createFromUrl(serverUrl);
```

With those flags set:

- `DefaultAgentCardResolver` inspects every fetched card. A pure v0.3 card
  (top-level `url`, no `supportedInterfaces[]`, or a `protocolVersion` in
  `[0.3, 1.0)`) is translated to a v1.0 representation with
  `protocolVersion: '0.3'` stamped on each synthesized `AgentInterface`. A
  hybrid card (v0.3 top-level fields **and** v1.0 `supportedInterfaces[]`) is
  treated as v1.0.
- Each transport factory's `create()` looks at the matched interface's
  `protocolVersion`. If it falls in `[0.3, 1.0)`, the factory instantiates
  the v0.3 compat transport (`LegacyJsonRpcTransport`, `LegacyRestTransport`,
  or `LegacyGrpcTransport`) instead of the native v1.0 transport. With the
  flag off, these legacy transports are never constructed at runtime.

`ClientFactory` itself does not take a `legacyCompat` option — the flag is
intentionally per transport factory and per resolver, mirroring the
per-handler opt-in on the server side.

The runnable demo (both v1.0 and mock-v0.3 peers in one process) is
[`compat-v1-client`](../src/samples/agents/compat-v1-client/).

---

## Caveats: what doesn't survive the round trip

Even with the compat layer enabled, the two protocol versions are not
byte-equivalent. Some v1.0 surface area has no v0.3 representation and gets
dropped or defaulted; the rest of this guide enumerates the cases you should
know about before turning the flag on.

### Methods with no v0.3 equivalent

| v1.0 method  | Status in v0.3                | Behavior under compat                                                                                                                                                                  |
| :----------- | :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ListTasks`  | Not implemented in v0.3       | A v1.0 client calling `client.listTasks(...)` against a v0.3 server fails with `UnsupportedOperationError` (JSON-RPC code `-32004`). The compat layer translates the call into a "method not implemented in v0.3" error rather than the generic invalid-request error. |

Per A2A v0.3 spec §3.5.6, `tasks/list` was a gRPC/REST-only operation in v0.3
and was never exposed over JSON-RPC. The v0.3 proto shipped here has no
`ListTasks` RPC at all, so the compat layer treats `ListTasks` as fully
absent on the v0.3 side — there's no degraded fallback.

If you need cross-version task enumeration, gate `listTasks` calls on the
peer's `protocolVersion` (the client's `transport.protocolVersion` exposes
this) or use an out-of-band index.

### Fields the compat layer drops or replaces

These differences come from the protocol data model itself; the compat
layer applies the documented defaults rather than failing.

| v1.0 field / shape                                                                                                                                                  | What happens going v1.0 → v0.3                                                                                                                                                                                                                                |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OAuthFlows.deviceCode` (v1.0 only)                                                                                                                                 | **Silently dropped.** v0.3 has no representation for the device-code flow. If `deviceCode` is the only declared flow on a `SecurityScheme`, the v0.3 card receives an empty `OAuthFlows` object — callers can guard via `Object.keys(result).length === 0`.   |
| `AuthenticationInfo.scheme` (single string) ↔ `PushNotificationAuthenticationInfo.schemes` (string array)                                                          | Going v0.3 → v1.0: only the **first** element of `schemes[]` is preserved and the rest are dropped (with a warning). Going v1.0 → v0.3: the single scheme is wrapped into a one-element array; empty becomes `[]`.                                            |
| `TaskStatusUpdateEvent.final` (removed in v1.0)                                                                                                                     | Going v1.0 → v0.3 the `final` flag is **computed** from the status state: `true` for `completed`, `canceled`, `failed`, or `rejected`; `false` otherwise.                                                                                                     |
| `SendMessageConfiguration.returnImmediately` ↔ `MessageSendConfiguration.blocking`                                                                                 | Inverted polarity (v1.0 `returnImmediately: true` ↔ v0.3 `blocking: false`, and vice versa).                                                                                                                                                                  |
| `AgentCard.supportedInterfaces[]` (v1.0) ↔ `(url, preferredTransport, additionalInterfaces)` (v0.3)                                                                | In **strict mode** (default), only interfaces whose `protocolVersion` is empty or in `[0.3, 1.0)` survive the v1.0 → v0.3 translation; if none qualify, `VersionNotSupportedError` is thrown. In **synthesis mode** (used by `legacyAgentCardRouter`), every interface survives and is restamped with `protocolVersion: '0.3'`. |
| `Part.content.$case` discriminator                                                                                                                                  | Translated to the v0.3 `kind:` discriminator on each part (`text`, `file`, `data`). File URI ↔ v0.3 `FilePart.file.uri`; file bytes ↔ v0.3 `FilePart.file.bytes`; the v1.0 flat `Part.filename` / `Part.mediaType` map back into `FilePart.file.name` / `FilePart.file.mimeType`. |

### REST wire-shape caveats

Both the v0.3 and v1.0 REST surfaces speak **proto-JSON of their respective
proto types** (per each version's `google.api.http` annotations) — they do
**not** use the JSON-Schema bodies with `kind:` discriminators that you would
send over v0.3 JSON-RPC. The two REST shapes look similar but have small
field-name differences:

| Aspect              | v0.3 REST                 | v1.0 REST                 |
| :------------------ | :------------------------ | :------------------------ |
| Path prefix         | `/v1/<operation>`         | `/<operation>`            |
| Request body field  | `request` (a `Message`)   | `message` (a `Message`)   |
| `Message` payload   | `content[]`               | `parts[]`                 |
| Response shape      | proto-JSON `SendMessageResponse` (`{task: {...}}` or `{msg: {...}}`) | proto-JSON `SendMessageResponse` (same oneof, v1.0 types) |
| Response Content-Type | `application/json`      | `application/a2a+json`    |
| `TaskState` encoding | `TASK_STATE_COMPLETED`   | `TASK_STATE_COMPLETED`    |

If you need to issue v0.3 wire shapes with JSON-Schema-style envelopes
(`{kind: 'task', state: 'completed', parts: [{kind: 'text', ...}]}`), use the
v0.3 JSON-RPC endpoint, not the REST endpoint.

### Push notifications: routed per webhook

A v1.0-only deployment delivers every push as a `StreamResponse` envelope
with `Content-Type: application/a2a+json`. With the compat layer enabled, the
sender (`createLegacyAwarePushNotificationSender`) routes per webhook:

| Wire version the webhook was registered under | Body shape                                                          | Content-Type            |
| :-------------------------------------------- | :------------------------------------------------------------------ | :---------------------- |
| `1.0`                                         | `StreamResponse` envelope                                           | `application/a2a+json`  |
| `0.3` (or absent `A2A-Version` at registration) | The bare event object (v0.3 `Task`, `TaskStatusUpdateEvent`, or `TaskArtifactUpdateEvent` discriminated by its `kind` field) | `application/json`      |

Routing is anchored on the `requestedVersion` recorded **when the webhook was
registered** (captured by `InMemoryPushNotificationStore` on `save()` and
exposed via `loadWithMetadata`), not the version of the request that
triggered the delivery. A v0.3-registered webhook keeps receiving v0.3 bodies
even when the task is later driven by a v1.0 client.

> **Caveat for custom `PushNotificationStore` implementations.**
> `loadWithMetadata` is optional. If your custom store does not implement
> it, the sender defaults each dispatch to the wire version of the request
> that *triggered* the dispatch, falling back to `'0.3'` per spec §3.6.2
> when the triggering context carries no version. In a deployment that
> opts into the compat layer, this can mean a v0.3 webhook receives a v1.0
> body (or vice versa) when the registering and triggering clients disagree.
> Implement `loadWithMetadata` on custom stores (mirror the 3-line version
> in `InMemoryPushNotificationStore`) to preserve the originating wire
> version per config.
>
> Pure v1.0 deployments (no compat opt-in) are unaffected: every triggering
> context carries `'1.0'` and the built-in V1 serializer handles every
> dispatch.

### Transport headers

| Header                | v0.3                  | v1.0                          |
| :-------------------- | :-------------------- | :---------------------------- |
| Extensions header     | `X-A2A-Extensions`    | `A2A-Extensions`              |
| Version header        | *(absent → 0.3)*      | `A2A-Version: 1.0` (required) |
| REST Content-Type     | `application/json`    | `application/a2a+json`        |

---

If you're operating a v0.3 server and considering migration, the
[migration guide](migration-guide.md) walks through every SDK-level breaking
change.

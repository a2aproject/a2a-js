# A2A Protocol Backward Compatibility (v0.3)

This directory (`src/compat/v0_3/`) provides the foundational data representations necessary for modern `v1.0` clients and servers to interoperate with legacy `v0.3` A2A systems.

## Published entry points

The compat layer is shipped as six subpath exports off `@a2a-js/sdk`. Each subpath carries only the peer dependencies (`express`, `@grpc/grpc-js`) its runtime needs, so a Workers consumer that only opts into the compat-aware client transports never has to pull in Node-only modules.

| Subpath                                  | What it exports                                                                                                                                                                                                                                                                                                                                                                         | Peer deps           |
| :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------ |
| `@a2a-js/sdk/compat/v0_3`                | v0.3 protocol constants (`A2A_LEGACY_PROTOCOL_VERSION`, `LEGACY_HTTP_EXTENSION_HEADER`, `LEGACY_JSON_CONTENT_TYPE`, the `LEGACY_METHOD_*` literals) and method-name translators (`legacyJsonRpcToV1Method`, `v1MethodToLegacyJsonRpc`, `legacyJsonRpcToLegacyGrpcMethod`, `legacyGrpcToLegacyJsonRpcMethod`, `legacyGrpcToV1Method`, `v1MethodToLegacyGrpc`, `isLegacyJsonRpcMethod`, `isV1JsonRpcMethod`).  | none (Workers-safe) |
| `@a2a-js/sdk/compat/v0_3/server`         | Framework-agnostic transport handlers (`LegacyJsonRpcTransportHandler`, `LegacyRestTransportHandler`, `toLegacyHTTPError`), push-notification factory (`createLegacyAwarePushNotificationSender`) and serializer (`V03PushNotificationSerializer`), and the `LegacyA2AError` class. Mount the transport handlers from any HTTP runtime (Express, Fastify, Hono, Cloudflare Workers, …). | none (Workers-safe) |
| `@a2a-js/sdk/compat/v0_3/server/express` | Express routers (`legacyAgentCardRouter`, `legacyRestRouter`) that wrap the handlers above with the v0.3 well-known agent-card and REST endpoint paths. Header-based dispatch on `A2A-Version`.                                                                                                                                                                                         | `express`           |
| `@a2a-js/sdk/compat/v0_3/server/grpc`    | v0.3 gRPC service factory (`legacyGrpcService`), service descriptor (`LegacyA2AService`), and options type. Register alongside the v1.0 `grpcService` on the same gRPC `Server`.                                                                                                                                                                                                        | `@grpc/grpc-js`     |
| `@a2a-js/sdk/compat/v0_3/client`         | Card-resolver helpers (`isLegacyAgentCard`, `parseLegacyAgentCard`) and the v0.3 JSON-RPC + REST client transports (`LegacyJsonRpcTransport`, `LegacyRestTransport`).                                                                                                                                                                                                                   | none (Workers-safe) |
| `@a2a-js/sdk/compat/v0_3/client/grpc`    | v0.3 gRPC client transport (`LegacyGrpcTransport`), instantiated by the v1.0 `GrpcTransportFactory` when `legacyCompat: { enabled: true }` and the matched `AgentInterface.protocolVersion` falls in `[0.3, 1.0)`.                                                                                                                                                                      | `@grpc/grpc-js`     |

The bidirectional v0.3 ↔ v1.0 payload translators in `./translate/` are intentionally NOT part of the public surface and may change without a major-version bump.

## Data Representations

To support cross-version compatibility across JSON, REST, and gRPC, this directory manages three distinct legacy data representations inside `types/`:

### 1. Legacy v0.3 TypeScript Interfaces (`types/types.ts`)

This file contains TypeScript interfaces generated from the legacy v0.3 JSON schema.

- **Purpose**: This is the primary legacy format. Legacy JSON-RPC and REST implementations natively serialize to/from these interfaces. It acts as the foundational data model for legacy message payloads.

### 2. Legacy v0.3 REST Types (`types/rest_types.ts`)

This file contains dedicated snake_case TypeScript interfaces mirroring the internal types.

- **Purpose**: To support TCK and legacy REST clients/servers that send snake_case payloads over HTTP, importing base structures from `types.ts`.

### 3. Legacy v0.3 Protobuf Bindings (`types/pb/` + `grpc/pb/`)

The v0.3 protobuf bindings are split across two sibling directories, mirroring the v1.0 layer (`src/types/pb/` vs. `src/grpc/pb/`):

- `types/pb/a2a.ts` — generated by `ts-proto` with `outputServices=false`, `outputEncodeMethods=false`, `emitImportedFiles=false`. Contains message-type `interface`s, enum declarations, and per-message `fromJSON` / `toJSON` helpers only — no wire encode/decode, no gRPC services, no well-known-type files. The converters (`types/converters/from_proto.ts` and `to_proto.ts`) — and anything that imports them transitively, including the v1.0 `JsonRpcTransportFactory` / `RestTransportFactory` — stay Cloudflare Workers-compatible. Generated by `src/compat/v0_3/types/buf.gen.yaml`.
- `grpc/pb/a2a.ts` — generated by `ts-proto` with `outputServices=grpc-js` and then post-processed to drop its duplicate message-type interfaces in favor of `export type X = pb.X` re-exports from `../../types/pb/a2a.js`. Carries the wire `encode` / `decode` runtime, the well-known-type files (`google/protobuf/...`), and the `A2AServiceService` / `A2AServiceServer` / `A2AServiceClient` gRPC bindings consumed by `legacyGrpcService` and `LegacyGrpcTransport`. Generated by `src/compat/v0_3/grpc/buf.gen.yaml`; see `src/compat/v0_3/grpc/README.md` for the post-processing recipe.

- **Purpose**: To decode incoming bytes from legacy gRPC clients or encode outbound bytes to legacy gRPC servers, and to provide the service descriptors used by the compat-layer server and client transports.

## Translation Layer (`translate/`)

The `translate/` subdirectory contains bidirectional payload translators between the modern v1.0 protobuf types (in `src/types/pb/a2a.ts`) and the legacy v0.3 JSON types (in `src/compat/v0_3/types/types.ts`).

The naming convention is direction-anchored:

- `toCore<Entity>` converts a v0.3 value into the equivalent v1.0 proto value.
- `toCompat<Entity>` converts a v1.0 proto value into the equivalent v0.3 JSON value.

Translators are split per entity group (`parts.ts`, `messages.ts`, `tasks.ts`, `push_notifications.ts`, `security.ts`, `agent_card.ts`, `requests.ts`, `enums.ts`, `versions.ts`) for clarity and tree-shaking. The full surface is re-exported from `src/compat/v0_3/translate/index.ts`.

Notable policy decisions:

- `PushNotificationAuthenticationInfo.schemes` is truncated to a single scheme going v0.3 → v1.0; only the first entry is kept.
- The v1.0 `OAuthFlows.deviceCode` flow is silently dropped going v1.0 → v0.3 (v0.3 has no equivalent).
- `TaskStatusUpdateEvent.final` is computed from the status state going v1.0 → v0.3 (`true` for `completed`, `canceled`, `failed`, `rejected`).
- `SendMessageConfiguration.returnImmediately` ↔ `MessageSendConfiguration.blocking` with inverted polarity.
- `toCompatAgentCard(card)` filters `supportedInterfaces` to those whose `protocolVersion` is empty or in `[0.3, 1.0)` and throws `VersionNotSupportedError` if none qualify.
- `duplicateInterfacesForLegacy(interfaces, bindings)` appends a v0.3 mirror entry for each listed binding that doesn't already have one. Idempotent; use it when declaring an agent card to opt specific bindings into v0.3 advertisement.

## Version negotiation under `legacyCompat`

Per A2A spec §3.6.2, clients that omit the `A2A-Version` header are treated as v0.3 requests. v0.3 advertisement and routing are strictly per-interface: a binding is only reachable at v0.3 if the agent card declares an `AgentInterface` for it with `protocolVersion: '0.3'`.

- `validateVersion(requestedVersion, card, binding)` accepts the request iff `requestedVersion` is in the set of versions declared for `binding` in `supportedInterfaces`.
- `legacyAgentCardRouter` calls `toCompatAgentCard(card)` (strict filter) and serves the resulting v0.3-shaped card to legacy-range requests. A v1.0-only card produces HTTP 400 on the legacy path.

Operators advertise a binding at v0.3 by declaring a per-interface `protocolVersion: '0.3'` — manually or via `duplicateInterfacesForLegacy`. The `compat-v1-server` sample shows the helper in use.

The v1.0 gRPC service factory (`src/server/grpc/grpc_service.ts`) intentionally does **not** carry a `legacyCompat` option; v0.3 gRPC clients are served by importing `legacyGrpcService` from `@a2a-js/sdk/compat/v0_3/server/grpc` and registering it alongside the v1.0 `grpcService` on the same `Server`. (The v1.0 `@a2a-js/sdk/server/grpc` barrel does not re-export `legacyGrpcService`; the explicit compat import keeps `@grpc/grpc-js` out of the v1.0 dependency graph for operators who only deploy the v1.0 service.)

### JSON-RPC method dispatch

`jsonRpcHandler({ legacyCompat: { enabled: true } })` routes each request body based on its `method` field:

- Method matches a v1.0 PascalCase name (`isV1JsonRpcMethod` → `true`, e.g. `SendMessage`, `ListTasks`) → v1.0 dispatcher.
- Anything else — kebab-style v0.3 names (`message/send`, `tasks/get`), unknown strings, or bodies with no `method` field at all → v0.3 dispatcher.

The fallback exists so malformed and unknown requests surface v0.3-shaped errors (`-32600 Invalid Request` for missing `method`, `-32602` for bad params) instead of the v1.0 path's blanket `-32602`, which is what header-less v0.3 clients expect per spec §3.6.2.

### REST wire format

`legacyRestRouter` / `LegacyRestTransportHandler` emit JSON with **snake_case** field names (`context_id`, `task_id`, `message_id`, `protocol_version`, …) to match the v0.3 reference proto's canonical proto-JSON wire form. Input handlers accept both casings (proto3 JSON parsers tolerate either), so v0.3 clients that send camelCase still work.

This deviates from the v1.0 REST handler (`src/server/express/rest_handler.ts`), which emits lowerCamelCase per proto3 JSON canonical form. The split is intentional: each handler matches the on-the-wire conventions of its respective spec version.

### `tasks/resubscribe` streaming contract

The legacy `tasks/resubscribe` handler always responds with `Content-Type: text/event-stream` and HTTP 200, even when the underlying call fails immediately (e.g. the task does not exist). Pre-stream errors are emitted as SSE error events on the open stream rather than as a plain JSON-RPC error response. Strict v0.3 clients reject anything other than `text/event-stream` on this method, so the header is committed before the first iterator pull. Other streaming methods (`message/stream`, `SubscribeToTask`) keep the peek-then-flush behaviour so a synchronous invalid-params error still surfaces as a JSON 200 error envelope.

## Push Notifications

Webhooks registered over v0.3 transports must receive the v0.3-shaped HTTP body, not the v1.0 `StreamResponse` wrapper. Per the v0.3 spec example (§9.5), the body is the **bare event object** (a v0.3 JSON `Task`, `TaskStatusUpdateEvent`, or `TaskArtifactUpdateEvent` discriminated by its `kind` field) with `Content-Type: application/json` — no `StreamResponse` discriminator and no JSON-RPC envelope.

This is implemented by two pieces working together:

1. **`PushNotificationStore` captures the wire version.** The `InMemoryPushNotificationStore` (and any conforming implementation) reads `context.requestedVersion` on `save()` and persists it alongside the config as a `StoredPushNotificationConfig { config, wireVersion }`. The wire version is surfaced via the optional `loadWithMetadata` read method.

2. **`DefaultPushNotificationSender` routes per wire version.** The sender prefers `loadWithMetadata` when the store implements it, otherwise falls back to `load` and defaults every entry to wire version `'0.3'` per spec §3.6.2's absent-header rule. It always registers `V1PushNotificationSerializer` under `'1.0'` and falls back to it (with a one-time warning per unknown version) when no serializer is registered for the entry's version.

### Enabling v0.3 push delivery

Use `createLegacyAwarePushNotificationSender` (exported from `@a2a-js/sdk/compat/v0_3/server`) instead of constructing the sender directly. It pre-registers `V03PushNotificationSerializer` under the `'0.3'` key:

```ts
import { InMemoryPushNotificationStore } from '@a2a-js/sdk/server';
import { createLegacyAwarePushNotificationSender } from '@a2a-js/sdk/compat/v0_3/server';

const store = new InMemoryPushNotificationStore();
const sender = createLegacyAwarePushNotificationSender(store);

// Hand both to your DefaultRequestHandler as usual.
```

v1.0-registered webhooks continue to receive the canonical `StreamResponse` body with `application/a2a+json`; v0.3-registered webhooks receive the bare-event JSON with `application/json`. Custom serializers (or overrides for the built-in `'0.3'` / `'1.0'` entries) can be supplied via the `serializers` option; user-supplied entries take precedence.

### Caveat for custom `PushNotificationStore` implementations

The `PushNotificationStore.loadWithMetadata` method is optional. The SDK's `InMemoryPushNotificationStore` implements it. **Custom store implementations that omit it cause the sender to default each dispatch to the wire version of the request that _triggered_ the dispatch (`context.requestedVersion`),** falling back to `'0.3'` per spec §3.6.2 only when the triggering context carries no version.

What this means for the two deployment shapes a v1.0 server can take:

- **Pure v1.0 deployment** (no compat layer opted in): no concern. Every triggering context carries `'1.0'`, the built-in V1 serializer handles every dispatch, and no warnings are emitted — even with a custom store implementation.

- **v1.0 deployment with v0.3 compat opted in** (`createLegacyAwarePushNotificationSender`): each webhook receives the body shape of whichever client _triggered_ the dispatch, not necessarily of the client that originally registered the webhook. If a v1.0 client triggers an event for a task with a webhook registered by a legacy v0.3 client, that v0.3 webhook will receive a v1.0 body (and vice versa). Implement `loadWithMetadata` on your custom store (mirror `InMemoryPushNotificationStore`'s 3-line implementation) to preserve the originating wire version per config.

The compat layer (and therefore the caveat above) is opt-in and will be retired once the legacy v0.3 client base has migrated to v1.0.

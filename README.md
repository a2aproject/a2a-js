# A2A JavaScript SDK

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@a2a-js/sdk.svg)](https://www.npmjs.com/package/@a2a-js/sdk)

<!-- markdownlint-disable no-inline-html -->

<html>
   <h2 align="center">
   <img src="https://raw.githubusercontent.com/google-a2a/A2A/refs/heads/main/docs/assets/a2a-logo-black.svg" width="256" alt="A2A Logo"/>
   </h2>
   <h3 align="center">A JavaScript library that helps run agentic applications as A2AServers following the <a href="https://google-a2a.github.io/A2A">Agent2Agent (A2A) Protocol</a>.</h3>
</html>

<!-- markdownlint-enable no-inline-html -->

`@a2a-js/sdk` is the official TypeScript / JavaScript SDK for the A2A
Protocol. Use it to build A2A **servers** (agents exposing their capabilities
over the protocol) and A2A **clients** (applications discovering and driving
those agents) — one package, three wire transports (JSON-RPC,
HTTP+JSON/REST, gRPC), and an opt-in compatibility layer for v0.3 peers.

- 🚀 **v1.0 beta release** tracking [A2A Protocol Specification v1.0](https://a2a-protocol.org/v1.0.0/specification/).
- 🔌 **Three transports** — JSON-RPC, HTTP+JSON/REST, and gRPC (Node-only),
  all backed by a single `DefaultRequestHandler`.
- 🔄 **v0.3 backward compatibility** as an opt-in layer so v1.0 deployments
  can interoperate with peers still on v0.3 during a staged migration.

## Installation

You can install the A2A SDK using `npm`. The v1.0 beta release is now available:

```bash
npm install @a2a-js/sdk@next
```

### For Server Usage

If you plan to use the Express integration (imports from `@a2a-js/sdk/server/express`) for A2A server, you'll also need to install Express as it's a peer dependency:

```bash
npm install express
```

### For gRPC Usage

If you plan to use the GRPC transport (imports from `@a2a-js/sdk/server/grpc`, `@a2a-js/sdk/client/grpc`, or the gRPC-specific error helpers in `@a2a-js/sdk/errors/grpc`), you must install the required peer dependencies:

```bash
npm install @grpc/grpc-js @bufbuild/protobuf
```

---

## Compatibility

This SDK implements the A2A Protocol Specification [`v1.0.0`](https://a2a-protocol.org/v1.0.0/specification).

| Transport               | Client | Server |
| :---------------------- | :----: | :----: |
| **JSON-RPC**            |   ✅   |   ✅   |
| **HTTP+JSON/REST**      |   ✅   |   ✅   |
| **GRPC** (Node.js only) |   ✅   |   ✅   |

Upgrading from `0.3.x`? Read the
[v0.3 → v1.0 migration guide](docs/migration-guide.md).

## Documentation

**A2A Protocol Specification (v1.0.0):** <https://a2a-protocol.org/v1.0.0/specification/>

The protocol specification is the source of truth for message formats, task
lifecycle states, transport bindings, push notifications, extensions, and
authentication. This SDK provides a TypeScript implementation of that surface;
when in doubt about behavior, consult the specification.

SDK-specific guides live under [`docs/`](docs/):

- [Migration guide (`v0.3` → `v1.0`)](docs/migration-guide.md)
- [v0.3 compatibility guide](docs/compatibility-v0_3.md)

## Samples

End-to-end runnable examples live under
[`src/samples`](https://github.com/a2aproject/a2a-js/tree/main/src/samples).
Each sample directory has its own `README.md` with run instructions.

| Sample                                                                          | What it shows                                                                                                                                  |
| :------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| [`agents/sample-agent`](src/samples/agents/sample-agent/)                       | Minimal streaming agent: task lifecycle (`submitted` → `working` → artifact → `completed`) over JSON-RPC.                                      |
| [`agents/movie-agent`](src/samples/agents/movie-agent/)                         | Realistic agent backed by Genkit + the TMDB API.                                                                                               |
| [`agents/multi-transport-agent`](src/samples/agents/multi-transport-agent/)     | Single agent exposed over JSON-RPC, HTTP+JSON/REST, and gRPC simultaneously.                                                                   |
| [`agents/cancellable-agent`](src/samples/agents/cancellable-agent/)             | Implements `cancelTask` to support user-initiated cancellation of in-flight tasks.                                                             |
| [`agents/push-notification-agent`](src/samples/agents/push-notification-agent/) | Long-running agent that POSTs task updates to a client-provided webhook (server + webhook + client).                                           |
| [`agents/verify-signing`](src/samples/agents/verify-signing/)                   | Client-side verification of signed agent cards (JWS + JWKS).                                                                                   |
| [`authentication`](src/samples/authentication/)                                 | Server-side Bearer/JWT authentication using Passport, including a `UserBuilder` that propagates the authenticated user into the agent context. |
| [`extensions`](src/samples/extensions/)                                         | A2A protocol extension implemented as an `AgentExecutor` decorator that adds metadata to outgoing events.                                      |
| [`client/interceptors`](src/samples/client/interceptors/)                       | Client `CallInterceptor`s for header injection and request timing, plus per-call `AbortSignal.timeout(...)`.                                   |
| [`cli.ts`](src/samples/cli.ts)                                                  | Multi-transport interactive CLI client (JSON-RPC / REST / gRPC) with optional Google ADC authentication.                                       |
| [`agents/compat-v1-server`](src/samples/agents/compat-v1-server/)               | v1.0-native server with `legacyCompat: { enabled: true }` on every transport — JSON-RPC, REST, gRPC, agent card, and push notifications.       |
| [`agents/compat-v1-client`](src/samples/agents/compat-v1-client/)               | v1.0-native client driving both the compat-aware server above and a hand-rolled mock v0.3 server in-process; pairs with `compat-v1-server`.    |

To run a sample, install dependencies inside `src/samples` and use the
provided npm scripts:

```bash
cd src/samples
npm install
npm run agents:sample-agent     # see src/samples/package.json for the full list
```

## Capability overview

This section is a quick orientation. For wire-format details and full
semantics, follow the spec links and the sample `README.md` files.

### Servers

The server side is built around three pieces:

- **`AgentExecutor`** — your business logic. Receives a `RequestContext` and
  publishes `Message`, `Task`, status, and artifact events to an
  `ExecutionEventBus`.
- **`DefaultRequestHandler`** — orchestrates message routing, task storage,
  cancellation, and push notifications.
- **Transport adapters** — `jsonRpcHandler` and `restHandler` from
  `@a2a-js/sdk/server/express`, plus `grpcService` from
  `@a2a-js/sdk/server/grpc`. All three can be mounted against the same
  `DefaultRequestHandler` instance (see the
  [multi-transport-agent](src/samples/agents/multi-transport-agent/) sample).

Reference samples:
[`sample-agent`](src/samples/agents/sample-agent/),
[`multi-transport-agent`](src/samples/agents/multi-transport-agent/),
[`cancellable-agent`](src/samples/agents/cancellable-agent/),
[`push-notification-agent`](src/samples/agents/push-notification-agent/).

### Clients

Use [`ClientFactory`](src/client/factory.ts) to build a `Client`:

- `factory.createFromUrl(baseUrl, path?)` fetches the agent card and selects
  the best matching transport based on `supportedInterfaces` and
  `preferredTransports`.
- `factory.createFromAgentCard(card)` works from an in-memory `AgentCard`.

Available transport factories:
[`JsonRpcTransportFactory`](src/client/transports/json_rpc_transport.ts),
[`RestTransportFactory`](src/client/transports/rest_transport.ts), and
[`GrpcTransportFactory`](src/client/transports/grpc/grpc_transport.ts) (Node.js
only, exported from `@a2a-js/sdk/client/grpc`).

Each `Client` method (`sendMessage`, `sendMessageStream`, `getTask`,
`cancelTask`, `createTaskPushNotificationConfig`, …) accepts a
`RequestOptions` object that supports per-call `signal`, custom
`serviceParameters` (HTTP headers), and `context`.

Reference samples:
[`cli.ts`](src/samples/cli.ts),
[`client/interceptors`](src/samples/client/interceptors/).

### Streaming

Long-running tasks publish a stream of `task`, `status-update`, and
`artifact-update` events. On the server, publish events through the
`ExecutionEventBus`. On the client, consume them by iterating
`client.sendMessageStream(...)` (an `AsyncGenerator`).

See the spec section
[Streaming](https://a2a-protocol.org/v1.0.0/specification/#312-send-streaming-message)
and the [`sample-agent`](src/samples/agents/sample-agent/) /
[`movie-agent`](src/samples/agents/movie-agent/) samples.

### Task cancellation

Implement `cancelTask(taskId, eventBus)` on your `AgentExecutor` and have your
`execute` loop check for cancellation before each unit of work. Publish a
final `TaskState.TASK_STATE_CANCELED` status update when aborting.

See the spec section
[`cancelTask`](https://a2a-protocol.org/v1.0.0/specification/#315-cancel-task)
and the [`cancellable-agent`](src/samples/agents/cancellable-agent/) sample.

### Push notifications

For long-running tasks where the client cannot keep an SSE / gRPC stream open,
A2A supports webhook-based push notifications:

1. Declare `capabilities.pushNotifications: true` on your agent card.
2. Wire `InMemoryPushNotificationStore` and `DefaultPushNotificationSender`
   into `DefaultRequestHandler` (or provide your own implementations).
3. Clients send a `taskPushNotificationConfig` (URL + optional token) with
   their `MessageSendParams`. The server POSTs every task / status / artifact
   event to that URL.

See the spec section
[Push Notifications](https://a2a-protocol.org/v1.0.0/specification/#43-push-notification-objects)
and the [`push-notification-agent`](src/samples/agents/push-notification-agent/)
sample (which includes a runnable webhook receiver).

### Client customization

`@a2a-js/sdk/client` exposes a transport-agnostic `CallInterceptor` interface
with `before` / `after` hooks for every method. Common uses:

- Request logging and metrics.
- Header injection (request IDs, distributed-tracing headers, custom routing).
- A2A protocol extensions (modifying `serviceParameters`).

For authentication, the SDK includes
[`createAuthenticatingFetchWithRetry`](src/client/auth-handler.ts) and the
`AuthenticationHandler` interface, which automatically attach Authorization
headers and retry on 401/403 responses.

See the [`client/interceptors`](src/samples/client/interceptors/) sample for
header injection + per-call `AbortSignal.timeout(...)`, and the
[`cli.ts`](src/samples/cli.ts) sample for an `AuthenticationHandler` based on
Google Application Default Credentials.

### Authentication (server side)

Server-side authentication is implemented as Express middleware plus a
`UserBuilder` that converts the authenticated request into an A2A `User`
object available to your `AgentExecutor` via the `RequestContext`.

See the [`authentication`](src/samples/authentication/) sample for a complete
Bearer/JWT example using Passport.

### Protocol extensions

Extensions are advertised via `capabilities.extensions` on the agent card and
activated per-request through the `A2A-Extensions` HTTP header. They are
implemented as `AgentExecutor` decorators that wrap the published events.

See the [`extensions`](src/samples/extensions/) sample.

### Agent card signing

Agent cards can be signed using JWS so clients can verify their authenticity
via a published JWKS. The SDK exposes `verifyAgentCardSignature`,
`canonicalizeAgentCard`, and a server-side `AgentCardSignatureGenerator` hook
on `DefaultRequestHandler`.

See the [`agents/verify-signing`](src/samples/agents/verify-signing/) sample.

### v0.3 backward compatibility

A v1.0 server can transparently accept v0.3 clients (and a v1.0 client can
transparently talk to v0.3 servers) by opting into the compat layer with
`legacyCompat: { enabled: true }` on the relevant transport / handler. The
compat surface is shipped as six subpath exports off `@a2a-js/sdk`:

| Subpath                                  | Use it for                                                                                                                                                                                                                    |
| :--------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@a2a-js/sdk/compat/v0_3`                | v0.3 protocol constants and method-name translators. Workers-safe — no Node-only peer deps.                                                                                                                                   |
| `@a2a-js/sdk/compat/v0_3/server`         | Framework-agnostic transport handlers (`LegacyJsonRpcTransportHandler`, `LegacyRestTransportHandler`), push-notification factory (`createLegacyAwarePushNotificationSender`), serializer, and `LegacyA2AError`. Workers-safe. |
| `@a2a-js/sdk/compat/v0_3/server/express` | Express routers (`legacyAgentCardRouter`, `legacyRestRouter`) that wrap the handlers above with the v0.3 well-known agent-card and REST endpoint paths.                                                                       |
| `@a2a-js/sdk/compat/v0_3/server/grpc`    | `legacyGrpcService` + `LegacyA2AService`. Register alongside the v1.0 `grpcService` on the same gRPC `Server`.                                                                                                                |
| `@a2a-js/sdk/compat/v0_3/client`         | `LegacyJsonRpcTransport`, `LegacyRestTransport`, and the `isLegacyAgentCard` / `parseLegacyAgentCard` helpers. Workers-safe.                                                                                                  |
| `@a2a-js/sdk/compat/v0_3/client/grpc`    | `LegacyGrpcTransport`, instantiated by the v1.0 `GrpcTransportFactory` when the matched `AgentInterface.protocolVersion` falls in `[0.3, 1.0)`.                                                                               |

See the end-user [v0.3 compatibility guide](docs/compatibility-v0_3.md) for
opt-in mechanics and caveats (dropped fields, defaults, unavailable
methods like `ListTasks`, push-notification routing, per-interface v0.3 advertisement).
For the architecture-level walkthrough — translators, version negotiation
under §3.6.2, push-notification wire-version routing — see
[`src/compat/v0_3/README.md`](src/compat/v0_3/README.md), and the
[`compat-v1-server`](src/samples/agents/compat-v1-server/) /
[`compat-v1-client`](src/samples/agents/compat-v1-client/) samples for an
end-to-end demonstration across every transport.

## License

This project is licensed under the terms of the [Apache 2.0 License](https://raw.githubusercontent.com/google-a2a/a2a-python/refs/heads/main/LICENSE).

## Contributing

See [CONTRIBUTING.md](https://github.com/google-a2a/a2a-js/blob/main/CONTRIBUTING.md) for contribution guidelines.

# @a2a-js/sdk

## Project Overview

`@a2a-js/sdk` is the official TypeScript/JavaScript SDK for the **Agent2Agent (A2A) Protocol**. It enables developers to build both:

1.  **A2A Clients**: Applications that can discover, connect to, and interact with A2A agents.
2.  **A2A Servers**: Agents that expose their capabilities via the A2A protocol (JSON-RPC or HTTP+JSON/REST).

The SDK implements the **A2A Protocol Specification v1.0** with an opt-in
compatibility layer for v0.3 peers (see section 5 below).

## Tech Stack

*   **Language**: TypeScript (Node.js >= 20)
*   **Build System**: `tsup` (Outputs ESM and CJS)
*   **Testing Framework**: `vitest`
*   **Linting/Formatting**: `eslint`, `prettier`
*   **Peer Dependencies**: `express` (for server-side Express integration)

## Architecture & Key Components

The project is structured into modular entry points to allow tree-shaking and separation of concerns.

### 1. Common (`src/index.ts`)
*   **Types**: Core protocol types (`Message`, `Task`, `AgentCard`, `Part`) generated from protobuf.
*   **Constants**: Protocol constants (`AGENT_CARD_PATH`, `A2A_VERSION_HEADER`, `A2A_PROTOCOL_VERSION`, `A2A_CONTENT_TYPE`).
*   **Signing**: `generateAgentCardSignature`, `verifyAgentCardSignature`, `canonicalizeAgentCard`.

### 2. Client (`src/client/index.ts`)
*   **`ClientFactory`**: The main entry point. `createFromUrl(baseUrl, path?)` fetches the agent card; `createFromAgentCard(card)` works from an in-memory card.
*   **`Client`**: Transport-agnostic API (`sendMessage`, `sendMessageStream`, `getTask`, `cancelTask`, `listTasks`, `createTaskPushNotificationConfig`, …).
*   **Transport factories**:
    *   `JsonRpcTransportFactory`: JSON-RPC over HTTP (Workers-safe).
    *   `RestTransportFactory`: HTTP+JSON/REST per spec §11.3 (Workers-safe).
    *   `GrpcTransportFactory` (from `@a2a-js/sdk/client/grpc`): Node only.
*   **`CallInterceptor`**: `before` / `after` hooks for header injection, metrics, A2A extensions.
*   **Auth**: `AuthenticationHandler` and `createAuthenticatingFetchWithRetry` for token refresh + 401/403 retry.
*   **`DefaultAgentCardResolver`**: Stand-alone card fetcher/parser; pass into `ClientFactoryOptions` (e.g. with `legacyCompat: { enabled: true }`).

### 3. Server (`src/server/index.ts`)
*   **`AgentExecutor`**: The core interface you implement (`execute`, `cancelTask`).
*   **`DefaultRequestHandler`**: Orchestrates request routing, task storage, version validation, cancellation, push notifications.
*   **`ExecutionEventBus`**: Used inside `AgentExecutor` to publish events; wrap each event with `AgentEvent.message(...)` / `AgentEvent.task(...)` / `AgentEvent.statusUpdate(...)` / `AgentEvent.artifactUpdate(...)`.
*   **`InMemoryTaskStore`**: Default tenant-scoped task store. Implements `list()` for `ListTasks`.
*   **Push Notifications**: `PushNotificationSender`, `InMemoryPushNotificationStore`, `V1PushNotificationSerializer`, `DefaultPushNotificationSender`.
*   **Errors**: `TaskNotFoundError`, `RequestMalformedError`, `VersionNotSupportedError`, `UnsupportedOperationError`, `PushNotificationNotSupportedError`, etc.
*   **Version**: `validateVersion`, `getSupportedVersions`.

### 4. Server Express Integration (`src/server/express/index.ts`)
*   **Handlers**: `agentCardHandler`, `jsonRpcHandler`, `restHandler` for mounting A2A endpoints. All three accept a `legacyCompat: { enabled: boolean }` option.
*   **`UserBuilder`**: Middleware-friendly callback for extracting user identity from requests.

### 4b. Server gRPC Integration (`src/server/grpc/index.ts`)
*   **`grpcService`** + **`A2AService`** descriptor for `grpc.Server.addService(...)`.

### 5. v0.3 Backward Compatibility (`src/compat/v0_3/`)
The compat layer is shipped as six subpath exports off `@a2a-js/sdk`, mirroring the v1.0 layout (`server` is framework-agnostic; `server/express` and `server/grpc` carry the runtime-specific bits):

*   **`@a2a-js/sdk/compat/v0_3`** — v0.3 protocol constants and method-name translators (`isLegacyJsonRpcMethod`, `isV1JsonRpcMethod`). Workers-safe (no Node-only peer deps).
*   **`@a2a-js/sdk/compat/v0_3/server`** — Framework-agnostic transport handlers (`LegacyJsonRpcTransportHandler`, `LegacyRestTransportHandler`) and the push-notification factory (`createLegacyAwarePushNotificationSender`). Workers-safe.
*   **`@a2a-js/sdk/compat/v0_3/server/express`** — Express routers (`legacyAgentCardRouter`, `legacyRestRouter`); mount alongside or under the v1.0 `agentCardHandler` / `restHandler` to negotiate v0.3 by `A2A-Version` header.
*   **`@a2a-js/sdk/compat/v0_3/server/grpc`** — v0.3 gRPC service (`legacyGrpcService`, `LegacyA2AService`); register alongside the v1.0 `grpcService` on the same `Server`.
*   **`@a2a-js/sdk/compat/v0_3/client`** — v0.3 JSON-RPC + REST client transports (`LegacyJsonRpcTransport`, `LegacyRestTransport`) and card-resolver helpers. Workers-safe.
*   **`@a2a-js/sdk/compat/v0_3/client/grpc`** — v0.3 gRPC client transport (`LegacyGrpcTransport`), lazy-loaded by the v1.0 `GrpcTransportFactory`.

The bidirectional v0.3 ↔ v1.0 translators in `./translate/` are intentionally internal. See `src/compat/v0_3/README.md` for the full architecture.

## Building and Running

### Key Commands
| Command | Description |
| :--- | :--- |
| `npm run build` | Builds the SDK using `tsup` into `dist/`. |
| `npm test` | Runs unit tests using `vitest`. |
| `npm run lint`    | Runs all linting checks and applies automatic fixes (ESLint + Prettier + betterer). |
| `npm run lint:ci` | Runs all linting checks without applying fixes. Fails if any issues are found.      |
| `npm run format:readme` | Formats the README file. |

## Samples

The `src/samples` directory contains practical examples. Each subdirectory has its own `README.md` with run instructions.

*   **`agents/`**:
    *   `sample-agent/`: Minimal streaming agent over JSON-RPC.
    *   `movie-agent/`: A realistic agent backed by Genkit + the TMDB API.
    *   `multi-transport-agent/`: One agent exposed over JSON-RPC, REST, and gRPC simultaneously from a single `DefaultRequestHandler`.
    *   `cancellable-agent/`: Implements `cancelTask` so a client can abort an in-flight task.
    *   `push-notification-agent/`: Long-running agent that POSTs events to a client-provided webhook (server + webhook receiver + client).
    *   `verify-signing/`: Client-side verification of signed agent cards (JWS + JWKS).
    *   `compat-v1-server/`: v1.0-native server with `legacyCompat: { enabled: true }` on every transport.
    *   `compat-v1-client/`: v1.0-native client driving both the compat-aware server above and an in-process mock v0.3 server.
*   **`authentication/`**: Bearer/JWT authentication with Passport, including a `UserBuilder` that propagates the authenticated user into the agent context.
*   **`extensions/`**: Protocol extension implemented as an `AgentExecutor` decorator that stamps metadata onto outgoing events.
*   **`client/interceptors/`**: Client `CallInterceptor`s for header injection and request timing, plus per-call `AbortSignal.timeout(...)`.
*   **`cli.ts`**: Multi-transport interactive CLI client (JSON-RPC / REST / gRPC) with optional Google ADC authentication.

## Development Conventions

*   **Testing**: All new features should have accompanying unit tests in `test/` or alongside source files.
*   **Exports**: The project uses specific export paths in `package.json` (`.`, `./client`, `./client/grpc`, `./server`, `./server/express`, `./server/grpc`, `./compat/v0_3`, `./compat/v0_3/server`, `./compat/v0_3/server/express`, `./compat/v0_3/server/grpc`, `./compat/v0_3/client`, `./compat/v0_3/client/grpc`). Ensure new components are exported from the correct entry point.

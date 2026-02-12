# @a2a-js/sdk

## Project Overview

`@a2a-js/sdk` is the official TypeScript/JavaScript SDK for the **Agent2Agent (A2A) Protocol**. It enables developers to build both:

1.  **A2A Clients**: Applications that can discover, connect to, and interact with A2A agents.
2.  **A2A Servers**: Agents that expose their capabilities via the A2A protocol (JSON-RPC or HTTP+JSON/REST).

The SDK implements the **A2A Protocol Specification v0.3.0**.

## Tech Stack

*   **Language**: TypeScript (Node.js >= 18)
*   **Build System**: `tsup` (Outputs ESM and CJS)
*   **Testing Framework**: `vitest`
*   **Linting/Formatting**: `eslint`, `prettier`
*   **Peer Dependencies**: `express` (for server-side Express integration)

## Architecture & Key Components

The project is structured into modular entry points to allow tree-shaking and separation of concerns.

### 1. Common (`src/index.ts`)
*   **Types**: Core protocol types (`Message`, `Task`, `AgentCard`).
*   **Constants**: Protocol constants like `AGENT_CARD_PATH`.
*   **Errors**: Common error classes (`A2AError`).

### 2. Client (`src/client/index.ts`)
*   **`ClientFactory`**: The main entry point for creating clients. Can create clients from a base URL or an `AgentCard`.
*   **`A2AClient`**: The interface for sending messages and streams.
*   **Transports**:
    *   `JsonRpcTransport`: Uses JSON-RPC over HTTP.
    *   `RestTransport`: Uses standard HTTP+JSON REST patterns.
*   **Interceptors**: `CallInterceptor` for modifying requests/responses (e.g., adding auth headers).
*   **Auth**: `AuthenticationHandler` and `createAuthenticatingFetchWithRetry` for handling token refresh logic.

### 3. Server (`src/server/index.ts`)
*   **`AgentExecutor`**: The core interface you implement to define your agent's logic (`execute`, `cancelTask`).
*   **`DefaultRequestHandler`**: Orchestrates request processing, task management, and event dispatching.
*   **`ExecutionEventBus`**: Used within `AgentExecutor` to publish `Message`, `Task`, and `Artifact` updates.
*   **`InMemoryTaskStore`**: Default in-memory storage for task state.
*   **Push Notifications**: `PushNotificationSender` and `InMemoryPushNotificationStore` for async updates.

### 4. Server Express Integration (`src/server/express/index.ts`)
*   **Handlers**: `agentCardHandler`, `jsonRpcHandler`, `restHandler` to easily mount A2A endpoints in an Express app.
*   **`UserBuilder`**: Middleware for extracting user identity from requests.

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

The `src/samples` directory contains practical examples:

*   **`agents/`**:
    *   `movie-agent/`: A sample agent that queries movie data from TMDB.
    *   `sample-agent/`: A basic reference agent implementation.
*   **`authentication/`**: Examples of how to implement authentication middleware and user building.
*   **`extensions/`**: Examples of using protocol extensions.
*   **`cli.ts`**: A CLI tool example for interacting with agents.

## Development Conventions

*   **Testing**: All new features should have accompanying unit tests in `test/` or alongside source files.
*   **Exports**: The project uses specific export paths in `package.json` (`.`, `./client`, `./server`, `./server/express`). Ensure new components are exported from the correct entry point.

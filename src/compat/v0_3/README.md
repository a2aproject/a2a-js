# A2A Protocol Backward Compatibility (v0.3)

This directory (`src/compat/v0_3/`) provides the foundational data representations necessary for modern `v1.0` clients and servers to interoperate with legacy `v0.3` A2A systems.

## Data Representations

To support cross-version compatibility across JSON, REST, and gRPC, this directory manages three distinct legacy data representations inside `types/`:

### 1. Legacy v0.3 TypeScript Interfaces (`types/types.ts`)

This file contains TypeScript interfaces generated from the legacy v0.3 JSON schema.

- **Purpose**: This is the primary legacy format. Legacy JSON-RPC and REST implementations natively serialize to/from these interfaces. It acts as the foundational data model for legacy message payloads.

### 2. Legacy v0.3 REST Types (`types/rest_types.ts`)

This file contains dedicated snake_case TypeScript interfaces mirroring the internal types.

- **Purpose**: To support TCK and legacy REST clients/servers that send snake_case payloads over HTTP, importing base structures from `types.ts`.

### 3. Legacy v0.3 Protobuf Bindings (`types/pb/a2a.ts`)

This module contains the native TypeScript Protobuf bindings generated for the legacy v0.3 gRPC protocol via `ts-proto`.

- **Purpose**: To decode incoming bytes from legacy gRPC clients or encode outbound bytes to legacy gRPC servers.

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
- `toCompatAgentCard` filters `supportedInterfaces` to those whose `protocolVersion` is empty or in `[0.3, 1.0)` and throws `VersionNotSupportedError` if none qualify.

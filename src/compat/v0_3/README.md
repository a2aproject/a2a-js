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

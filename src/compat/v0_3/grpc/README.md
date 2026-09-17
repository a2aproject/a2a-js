# Legacy v0.3 gRPC Service Generation

This directory (`src/compat/v0_3/grpc/`) contains the configuration for generating the **v0.3** gRPC service definitions consumed by the compat-layer server (`legacyGrpcService`) and client (`LegacyGrpcTransport`). The split mirrors the v1.0 layer (`src/grpc/` for services vs. `src/types/` for message types) and exists for the same reason: keeping the v0.3 message-type bindings (in the sibling `src/compat/v0_3/types/pb/a2a.ts`) free of `@grpc/grpc-js` imports so that `from_proto.ts` / `to_proto.ts` — which are reached transitively by the v1.0 `JsonRpcTransportFactory` / `RestTransportFactory` — remain Cloudflare Workers-compatible.

## Prerequisites

Ensure you have the project dependencies installed:

```bash
npm install
```

## Generating Code

To generate the gRPC service definitions, run the following command from this directory (`src/compat/v0_3/grpc`):

```bash
npx buf generate
```

This will (re)generate `./pb/a2a.ts` along with the transitive `./pb/google/**` files (as configured in `buf.gen.yaml`).

## Post-Processing

**Important:** After running the generation, a post-processing step is **necessary** — the same one documented in `src/grpc/README.md` for the v1.0 layer.

The `buf` generation produces a file (`src/compat/v0_3/grpc/pb/a2a.ts`) that contains both the service definitions and the message types. However, to keep the message types canonical (and to keep them out of the grpc-js import graph for the converters), the generated file must be post-processed to:

1. Add `import * as pb from "../../types/pb/a2a.js";` at the top of the file (after the existing `@grpc/grpc-js` import block).
2. Replace every `export interface X { ... }` and `export enum X { ... }` block for message/enum types with an alias `export type X = pb.X;`. Do **not** touch:
   - `export interface A2AServiceServer`
   - `export interface A2AServiceClient`
   - `export interface MessageFns<T>`
3. Keep every `export const X: MessageFns<X> = { encode, decode, ... }` runtime block — the service descriptors call them for wire (de)serialization.
4. Keep `protobufPackage`, `A2AServiceService`, `A2AServiceClient`, and the `to/fromTimestamp` helpers.

The result is a file that exposes the message types as type aliases over the canonical definitions in `../../types/pb/a2a.ts` while still carrying its own runtime `encode`/`decode` implementations (which the gRPC service descriptors call). This is the same pattern v1.0 uses for `src/grpc/pb/a2a.ts`.

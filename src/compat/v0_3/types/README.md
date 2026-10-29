# Compatibility Types Generation (v0.3)

This directory (`src/compat/v0_3/types/`) contains the configuration and definitions for generating legacy v0.3 data model definitions for the A2A SDK. The generation process compiles legacy JSON schema interfaces (via `json-schema-to-typescript`) and legacy gRPC Protobuf bindings (via [Buf](https://buf.build/) and `ts-proto`).

## Prerequisites

Ensure you have the project dependencies installed:

```bash
npm install
```

## Generating Code

### Automated JSON Schema Generation

To fetch and generate the legacy JSON schema interfaces (`types.ts`), run the following command from the root of the repository:

```bash
npm run generate:compat
```

### Manual Protobuf Generation

To generate or update the legacy v0.3 message-type Protobuf bindings (`pb/a2a.ts`), run the following command manually from this directory (`src/compat/v0_3/types/`):

```bash
npx buf generate
```

This will compile the legacy Protobuf message definitions into `./pb/a2a.ts` as configured in `buf.gen.yaml`.

The generated `pb/a2a.ts` contains:

- All v0.3 message-type `interface` declarations (`Task`, `Message`, …).
- All v0.3 `enum` declarations + their `fromJSON` / `toJSON` helpers.
- Per-message `Foo.fromJSON` / `Foo.toJSON` helpers (because `outputJsonMethods=true`).
- The `protobufPackage` constant.

It deliberately omits:

- Wire `encode` / `decode` methods (because `outputEncodeMethods=false`) — those live exclusively in the sibling `src/compat/v0_3/grpc/pb/a2a.ts`, which the gRPC service descriptors call.
- gRPC service descriptors (because `outputServices=false`) — those are also in `src/compat/v0_3/grpc/pb/a2a.ts`.
- Transitively imported `.proto` files such as `google/protobuf/struct.proto` (because `emitImportedFiles=false`) — the well-known-type files live exclusively in `src/compat/v0_3/grpc/pb/google/`.

This split mirrors the v1.0 layer (`src/types/` vs. `src/grpc/`) and ensures `from_proto.ts` / `to_proto.ts` — and anything that imports them transitively, including the v1.0 `JsonRpcTransportFactory` and `RestTransportFactory` — stay free of `@grpc/grpc-js` and any wire-encoding runtime. That is required so those v1.0 factories keep working in the Cloudflare Workers runtime.

See `src/compat/v0_3/grpc/README.md` for the parallel service-side generation and post-processing procedure.

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
To generate or update the legacy gRPC Protobuf bindings (`pb/a2a.ts`), run the following command manually from this directory (`src/compat/v0_3/types/`):

```bash
npx buf generate
```

This will compile the legacy Protobuf definitions into the `./pb` directory as configured in `buf.gen.yaml`.

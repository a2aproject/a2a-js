# Types Generation

This directory contains the configuration for generating types definitions for the A2A SDK from the proto file. The generation process uses [Buf](https://buf.build/) and `ts-proto`.

## Prerequisites

Ensure you have the project dependencies installed:

```bash
npm install
```

This project uses `@bufbuild/buf` which is listed in the `devDependencies`.
Add the `a2a_types.proto` files to the `pb` directory.

## Generating Code

To generate the gRPC types definitions, run the following command from this directory (`src/types`):

```bash
npx buf generate
```

This will generate the TypeScript files in the `./pb` directory (as configured in `buf.gen.yaml`).

## Post-Processing

After generating the types, it may be convenient to remove the files generated in the `google` directory, as
only the `timestamp.ts` is used in the SDK types without services.
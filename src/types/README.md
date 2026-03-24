# Types Generation

This directory contains the configuration for generating types definitions for the A2A SDK from the proto file. The generation process uses [Buf](https://buf.build/) and `ts-proto`.

## Prerequisites

Ensure you have the project dependencies installed:

```bash
npm install
```

## Generating Code

To generate the gRPC types definitions, run the following command from this directory (`src/types`):

```bash
npx buf generate
```

This will generate the TypeScript files in the `./pb` directory (as configured in `buf.gen.yaml`).
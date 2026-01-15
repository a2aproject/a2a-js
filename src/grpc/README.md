# gRPC Service Generation

This directory contains the configuration for generating the gRPC service definitions for the A2A SDK. The generation process uses [Buf](https://buf.build/) and `ts-proto`.

## Prerequisites

Ensure you have the project dependencies installed:

```bash
npm install
```

This project uses `@bufbuild/buf` which is listed in the `devDependencies`.
Add the `a2a_services.proto` files to the `pb` directory.

## Generating Code

To generate the gRPC service definitions, run the following command from this directory (`src/grpc`):

```bash
npx buf generate
```

This will generate the TypeScript files in the `./pb` directory (as configured in `buf.gen.yaml`).

## Post-Processing

**Important:** After running the generation, a post-processing step is **necessary**.

The `buf` generation process produces a file (e.g., `src/grpc/pb/a2a_services.ts`) that contains both the service definitions and the message types. However, to maintain consistency across the SDK and ensure that we are using the canonical types, we must update the generated file to import the actual types from the central types definition file.

**Steps:**

1.  Open the generated file (e.g., `src/grpc/pb/a2a_services.ts`).
2.  Locate the imports/type definitions section.
3.  Replace the local message type definitions or imports with an import from the shared types file:
    `src/types/pb/a2a_types.ts`
    
    For example, change:
    ```typescript
    export interface Task { ... }
    ```
    to:
    ```typescript
    import * as pb from "../../types/pb/a2a_types.js";

    export type Task = pb.Task;
    // ... maps other types similarly
    ```

This ensures that the gRPC services operate on the same `Task` (and other) interfaces as the rest of the application, avoiding type mismatch errors.

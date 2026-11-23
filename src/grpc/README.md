# gRPC Service Generation

This directory contains the configuration for generating the gRPC service definitions for the A2A SDK. The generation process uses [Buf](https://buf.build/) and `ts-proto`.

## Prerequisites

Ensure you have the project dependencies installed:

```bash
npm install
```

## Generating Code

From the repository root:

```bash
npm run generate
```

This regenerates `src/types/pb` and `./pb` (including `./pb/google/*`, as configured in each `buf.gen.yaml`) and then runs `scripts/postprocess_generated_types.js`. Never edit generated files by hand: a clean run must leave `git status` empty.

## Post-Processing

The `buf` generation process produces a file (`src/grpc/pb/a2a.ts`) that contains both the service definitions and the message types. To make the gRPC services operate on the canonical types, the post-processing script replaces the generated message interfaces and enums with aliases of the ones in `src/types/pb/a2a.ts`:

```typescript
import * as pb from '../../types/pb/a2a.js';

export type Task = pb.Task;
// ... maps other types similarly
```

It also patches the binary codecs so that fields which are optional in the canonical types (see `OPTIONAL_FIELDS` in the script) are skipped by the encoder when unset and left out by the decoder unless present on the wire. A message from a 1.0 peer then decodes to the same object over gRPC as over JSON. Finally, it deletes the `google/api/*` and `google/protobuf/descriptor.ts` codecs that buf emits for `a2a.proto`'s annotation imports, which the SDK doesn't use.

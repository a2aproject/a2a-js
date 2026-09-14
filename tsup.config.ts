import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/errors/index.ts',
    'src/errors/grpc/index.ts',
    'src/server/index.ts',
    'src/server/express/index.ts',
    'src/server/grpc/index.ts',
    'src/server/database/index.ts',
    'src/client/index.ts',
    'src/client/transports/grpc/index.ts',
    // v0.3 compat layer.
    'src/compat/v0_3/index.ts',
    'src/compat/v0_3/server/index.ts',
    'src/compat/v0_3/server/express/index.ts',
    'src/compat/v0_3/server/grpc/index.ts',
    'src/compat/v0_3/client/index.ts',
    'src/compat/v0_3/client/transports/grpc/index.ts',
    // `a2a-db` CLI. Node-only, so deliberately absent from test-build:workers-safe.
    'src/cli/a2a_db.ts',
    // Built separately, and external below, so the bin can report a missing kysely
    // before this module's top-level imports of it run.
    'src/cli/run.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  // Catches any module importing './run.js', not just the bin. Today only the bin does.
  external: ['./run.js'],
});

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/server/index.ts',
    'src/server/express/index.ts',
    'src/server/grpc/index.ts',
    'src/client/index.ts',
    'src/client/transports/grpc/index.ts',
    // v0.3 compat layer.
    'src/compat/v0_3/index.ts',
    'src/compat/v0_3/server/index.ts',
    'src/compat/v0_3/server/express/index.ts',
    'src/compat/v0_3/server/grpc/index.ts',
    'src/compat/v0_3/client/index.ts',
    'src/compat/v0_3/client/transports/grpc/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
});

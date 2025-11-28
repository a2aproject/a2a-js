import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/server/index.ts',
    'src/server/express/index.ts',
    'src/server/drizzle/index.ts',
    'src/client/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
});

import { defineConfig } from 'vitest/config';

// Integration suite: spawns the samples as subprocesses over real transports.
// Kept out of the default unit suite; run with `npm run test:integration`.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    // Kept above the spec's own 30s poll deadline so its errors surface first.
    testTimeout: 90_000,
    hookTimeout: 45_000,
    // Subprocesses bind ports and share stdout; run one file at a time.
    fileParallelism: false,
  },
});

import { defineConfig } from 'vitest/config';

// Integration suite: everything under test/integration, run with
// `npm run test:integration`. The samples smoke test spawns the samples as
// subprocesses over real transports and only runs here, because it needs the
// src/samples workspace installed. The in-process specs alongside it also run
// in the default unit suite; re-running them here is cheap and keeps this
// suite a complete view of the directory.
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

import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Only the samples smoke test is held back: it spawns the sample agent and
    // CLI as subprocesses and needs the src/samples workspace installed, so it
    // runs via its own config (`npm run test:integration`). The rest of
    // test/integration is in-process and runs here too, which keeps it in the
    // node version matrix and in the coverage report.
    exclude: [...configDefaults.exclude, 'test/integration/samples_smoke.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: ['src/**/*'],
      exclude: [
        'src/samples/**/*',
        'src/types/pb/**/*',
        'src/grpc/pb/**/*',
        'src/compat/v0_3/types/pb/**/*',
        'src/compat/v0_3/grpc/pb/**/*',
        'src/compat/v0_3/types/types.ts',
        'src/compat/v0_3/types/rest_types.ts',
      ],
    },
  },
});

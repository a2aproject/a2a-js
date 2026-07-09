import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Integration tests spawn sample subprocesses and need the src/samples
    // workspace installed; they run via their own config (`npm run test:integration`).
    exclude: [...configDefaults.exclude, 'test/integration/**'],
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

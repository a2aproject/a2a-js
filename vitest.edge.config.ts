import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for Edge runtime testing.
 *
 * This config runs all tests EXCEPT the express subfolder, which contains
 * Node.js-specific code (Express framework) that is not compatible with
 * Edge runtime environments.
 *
 * The Edge runtime is provided by @edge-runtime/vm, which emulates
 * Cloudflare Workers, Vercel Edge Functions, and similar environments.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'edge-runtime',
    include: ['test/**/*.spec.ts'],
    exclude: [
      // Express tests require Node.js-specific APIs (http, Express framework)
      'test/server/a2a_express_app.spec.ts',
      // Node modules should always be excluded
      '**/node_modules/**',
    ],
  },
});

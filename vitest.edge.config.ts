import { mergeConfig } from 'vitest/config';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import defaultConfig from './vitest.config';

export default defineWorkersConfig(
  mergeConfig(defaultConfig, {
    test: {
      exclude: [
        // Express tests require Node.js-specific APIs (http, Express framework)
        'test/server/a2a_express_app.spec.ts',
        'test/e2e.spec.ts',
        'test/server/rest_handler.spec.ts',
        'test/server/push_notification_integration.spec.ts',
        // Node modules should always be excluded
        '**/node_modules/**',
      ],
      poolOptions: {
        workers: {
          miniflare: {
            compatibilityDate: '2024-04-01',
          },
        },
      },
    },
  })
);

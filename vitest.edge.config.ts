import { mergeConfig } from 'vitest/config';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import defaultConfig from './vitest.config';

export default defineWorkersConfig(
  mergeConfig(defaultConfig, {
    test: {
      exclude: [
        // Express tests require Node.js-specific APIs (http, Express framework)
        'test/server/express/**',
        // gRpc test require Node.js-specific gRPC module
        'test/server/grpc/*.spec.ts',
        'test/client/transports/grpc_transport.spec.ts',
        'test/e2e.spec.ts',
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

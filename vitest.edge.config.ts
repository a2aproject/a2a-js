import { mergeConfig } from 'vitest/config';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import defaultConfig from './vitest.config';

export default defineWorkersConfig(
  mergeConfig(defaultConfig, {
    test: {
      exclude: [
        // Express tests require Node.js-specific APIs (http, Express framework)
        'test/server/express/**',
        'test/compat/v0_3/server/express/**',
        // gRpc test require Node.js-specific gRPC module
        'test/server/grpc/*.spec.ts',
        'test/client/transports/grpc_transport.spec.ts',
        'test/errors_grpc.spec.ts',
        // v0.3 compat gRPC tests also pull in @grpc/grpc-js and are
        // Node-only for the same reason as the v1.0 gRPC tests above.
        'test/compat/v0_3/server/grpc/**',
        'test/compat/v0_3/client/transports/grpc/**',
        'test/e2e.spec.ts',
        'test/server/push_notification_integration.spec.ts',
        // Push-notification senders are exercised against a real Express webhook
        // (sibling pure-unit serializer tests stay in the edge suite).
        'test/server/push_notification_sender_serializer.spec.ts',
        'test/compat/v0_3/server/push_notification/create_legacy_aware_sender.spec.ts',
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

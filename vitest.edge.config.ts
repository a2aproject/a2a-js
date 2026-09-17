import { mergeConfig } from 'vitest/config';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import defaultConfig from './vitest.config';

const merged = mergeConfig(defaultConfig, {
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
      // The store suites reach their databases through native drivers. The stores
      // themselves are runtime-agnostic, which `test/edge/` proves against D1.
      'test/server/database_push_notification_store.spec.ts',
      'test/server/database_task_store.spec.ts',
      // `a2a-db` is Node-only: native drivers and temp files, neither of which workerd
      // has. Migrating is an operator step, never something a Worker does, so this is
      // permanent rather than pending.
      'test/cli/**',
      // Node modules should always be excluded
      '**/node_modules/**',
    ],
    poolOptions: {
      workers: {
        miniflare: {
          compatibilityDate: '2024-04-01',
          // `test/edge/` has no URL to connect to, so its database arrives as `env.TASKS_DB`.
          d1Databases: { TASKS_DB: 'a2a-edge-tests' },
        },
      },
    },
  },
});

// `mergeConfig` concatenates arrays, so the Node config's exclusion of `test/edge/`
// would land here too. That directory is the one place that needs workerd.
merged.test.exclude = (merged.test.exclude as string[]).filter(
  (pattern) => pattern !== 'test/edge/**'
);

export default defineWorkersConfig(merged);

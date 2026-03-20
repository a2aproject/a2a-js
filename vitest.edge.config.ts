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
        // AWS SDK tests require Node.js HTTP internals (not available in Workers).
        // aws-sdk-client-mock also calls mockClient() at describe scope which
        // violates the Workers global-scope constraint.
        'test/server/store/dynamo_task_store.spec.ts',
        'test/server/events/queue_lifecycle_manager.spec.ts',
        'test/server/events/sns_sqs_event_bus_manager.spec.ts',
        'test/server/integration/distributed_stack.spec.ts',
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

import { mergeConfig } from 'vitest/config';
import defaultConfig from './vitest.config';

export default mergeConfig(defaultConfig, {
  test: {
    environment: 'edge-runtime',
    exclude: [
      // Express tests require Node.js-specific APIs (http, Express framework)
      'test/server/a2a_express_app.spec.ts',
      // Node modules should always be excluded
      '**/node_modules/**',
    ],
  },
});

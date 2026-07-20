// Verifies that entrypoints declared Workers-safe never pull in
// Node-only peer deps (`@grpc/grpc-js`) or the pb-generated code
// path (`@bufbuild/protobuf`). Any hit fails the build.
//
// Run after `npm run build && npm run test-build`. Consumed by the
// `test-build` script and the `Run Build Tests` CI workflow.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Bundles that MUST NOT reference gRPC or pb at all.
const WORKERS_SAFE_BUNDLES = [
  'dist/tmp-checks/index.js',
  'dist/tmp-checks/errors/index.js',
  'dist/tmp-checks/client/index.js',
  'dist/tmp-checks/server/index.js',
  'dist/tmp-checks/compat/v0_3/index.js',
  'dist/tmp-checks/compat/v0_3/client/index.js',
  'dist/tmp-checks/compat/v0_3/server/index.js',
];

const FORBIDDEN = ['@grpc/grpc-js', '@bufbuild/protobuf'];

let failed = false;
for (const rel of WORKERS_SAFE_BUNDLES) {
  const abs = resolve(rel);
  let content;
  try {
    content = readFileSync(abs, 'utf8');
  } catch (e) {
    console.error(
      `FAIL: cannot read ${rel} — did you run \`npm run build && esbuild\`? (${e.message})`
    );
    failed = true;
    continue;
  }
  const hits = FORBIDDEN.filter((needle) => content.includes(needle));
  if (hits.length > 0) {
    console.error(
      `FAIL: ${rel} contains ${hits.join(', ')} — Workers-safe entrypoint must not pull Node-only deps`
    );
    failed = true;
  } else {
    console.log(`ok: ${rel} — no Node-only deps`);
  }
}

if (failed) process.exit(1);

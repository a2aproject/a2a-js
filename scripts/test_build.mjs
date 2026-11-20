import { isBuiltin } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';

const PROFILES = {
  'workers-safe': {
    platform: 'neutral',
    allowedPackages: ['jose'],
    entryPoints: [
      './dist/index.js',
      './dist/errors/index.js',
      './dist/client/index.js',
      './dist/server/index.js',
      './dist/plugins/index.js',
      './dist/compat/v0_3/index.js',
      './dist/compat/v0_3/client/index.js',
      './dist/compat/v0_3/server/index.js',
    ],
  },
  grpc: {
    platform: 'node',
    allowedPackages: ['jose', '@grpc/grpc-js', '@bufbuild/protobuf'],
    entryPoints: [
      './dist/errors/grpc/index.js',
      './dist/server/grpc/index.js',
      './dist/client/transports/grpc/index.js',
      './dist/compat/v0_3/server/grpc/index.js',
      './dist/compat/v0_3/client/transports/grpc/index.js',
    ],
  },
  express: {
    platform: 'node',
    allowedPackages: ['jose', 'express'],
    entryPoints: ['./dist/server/express/index.js', './dist/compat/v0_3/server/express/index.js'],
  },
  database: {
    platform: 'neutral',
    allowedPackages: ['jose', 'kysely'],
    entryPoints: ['./dist/server/database/index.js'],
  },
};

function getPackageName(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return name ? `${scope}/${name}` : specifier;
  }
  return specifier.split('/')[0];
}

function createAllowedImportsPlugin(name, profile) {
  const allowed = new Set(profile.allowedPackages);
  return {
    name: `allowlist-${name}`,
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') {
          return null;
        }
        if (args.path.startsWith('.') || args.path.startsWith('/')) {
          return null;
        }
        if (args.importer.split(path.sep).includes('node_modules')) {
          return null;
        }
        if (profile.platform === 'node' && isBuiltin(args.path)) {
          return null;
        }
        if (allowed.has(getPackageName(args.path))) {
          return null;
        }
        return {
          errors: [
            {
              text: `Disallowed import "${args.path}" in "${name}" profile (allowed: ${profile.allowedPackages.join(', ')})`,
            },
          ],
        };
      });
    },
  };
}

const requested = process.argv.slice(2);
const profileNames = requested.length > 0 ? requested : Object.keys(PROFILES);

for (const name of profileNames) {
  if (!(name in PROFILES)) {
    console.error(
      `Unknown test-build profile "${name}". Available: ${Object.keys(PROFILES).join(', ')}`
    );
    process.exit(1);
  }
}

await Promise.all(
  profileNames.map((name) => {
    const profile = PROFILES[name];
    return esbuild.build({
      entryPoints: profile.entryPoints,
      bundle: true,
      write: false,
      platform: profile.platform,
      outdir: 'dist/tmp-checks',
      outbase: './dist',
      plugins: [createAllowedImportsPlugin(name, profile)],
    });
  })
);

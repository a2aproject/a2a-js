// Verifies that each built export bundles under its target platform and imports
// only required dependencies and its profile's declared peers.

import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const requiredDeps = Object.keys(pkg.dependencies ?? {});
const distDir = `${path.resolve('dist')}${path.sep}`;

const PROFILES = {
  'workers-safe': { platform: 'neutral', peers: [] },
  grpc: { platform: 'node', peers: ['@grpc/grpc-js', '@bufbuild/protobuf'] },
  express: { platform: 'node', peers: ['express'] },
  database: { platform: 'neutral', peers: ['kysely'] },
};

const entryPointsByProfile = Object.fromEntries(Object.keys(PROFILES).map((name) => [name, []]));
for (const [subpath, target] of Object.entries(pkg.exports)) {
  const profile =
    Object.keys(PROFILES).find((name) => subpath.endsWith(`/${name}`)) ?? 'workers-safe';
  entryPointsByProfile[profile].push(target.import);
}

// e.g. 'jose/jwt' -> 'jose', '@bufbuild/protobuf/wkt' -> '@bufbuild/protobuf'
const getPackageName = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/', 2).join('/') : specifier.split('/', 1)[0];

await Promise.all(
  Object.entries(PROFILES).map(([name, { platform, peers }]) => {
    const allowed = new Set([...requiredDeps, ...peers]);
    const allowedLabel = [...allowed, ...(platform === 'node' ? ['Node built-ins'] : [])].join(
      ', '
    );
    return esbuild.build({
      entryPoints: entryPointsByProfile[name],
      bundle: true,
      write: false,
      platform,
      // esbuild requires outdir for multi-entry builds even when write is false.
      outdir: 'out',
      plugins: [
        {
          name: `allowlist-${name}`,
          setup(build) {
            // Match bare specifiers only; skip relative (./, ../) and absolute (/) paths.
            build.onResolve({ filter: /^[^./]/ }, (args) => {
              // Exempt transitive dependencies imported from node_modules.
              if (!args.importer.startsWith(distDir)) return null;
              if (platform === 'node' && isBuiltin(args.path)) return null;
              if (allowed.has(getPackageName(args.path))) return null;
              return {
                errors: [
                  {
                    text: `Disallowed import "${args.path}" in "${name}" profile (allowed: ${allowedLabel})`,
                  },
                ],
              };
            });
          },
        },
      ],
    });
  })
);

import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

export const PROFILES = {
  'workers-safe': { platform: 'neutral', peers: [] },
  grpc: { platform: 'node', peers: ['@grpc/grpc-js', '@bufbuild/protobuf'] },
  express: { platform: 'node', peers: ['express'] },
  database: { platform: 'neutral', peers: ['kysely'] },
};

export function classifyExports(exportsMap) {
  const entryPointsByProfile = Object.fromEntries(Object.keys(PROFILES).map((name) => [name, []]));
  for (const [subpath, target] of Object.entries(exportsMap)) {
    const profile =
      Object.keys(PROFILES).find((name) => subpath.endsWith(`/${name}`)) ?? 'workers-safe';
    entryPointsByProfile[profile].push(target.import);
  }
  return entryPointsByProfile;
}

const getPackageName = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/', 2).join('/') : specifier.split('/', 1)[0];

export function checkProfile({ name, platform, entryPoints, allowedPackages, distDir }) {
  const allowed = new Set(allowedPackages);
  const allowedLabel = [...allowed, ...(platform === 'node' ? ['Node built-ins'] : [])].join(', ');
  const normalizedDistDir = distDir.endsWith(path.sep) ? distDir : `${distDir}${path.sep}`;

  return esbuild.build({
    entryPoints,
    bundle: true,
    write: false,
    platform,
    // esbuild requires outdir for multi-entry builds even when write is false.
    outdir: 'out',
    nodePaths: [path.resolve('node_modules')],
    plugins: [
      {
        name: `allowlist-${name}`,
        setup(build) {
          build.onResolve({ filter: /^[^./]/ }, (args) => {
            // Exempt transitive dependencies imported from node_modules.
            if (!args.importer.startsWith(normalizedDistDir)) return null;
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const requiredDeps = Object.keys(pkg.dependencies ?? {});
  const distDir = path.resolve('dist');
  const entryPointsByProfile = classifyExports(pkg.exports);

  await Promise.all(
    Object.entries(PROFILES).map(([name, { platform, peers }]) =>
      checkProfile({
        name,
        platform,
        entryPoints: entryPointsByProfile[name],
        allowedPackages: [...requiredDeps, ...peers],
        distDir,
      })
    )
  );
}

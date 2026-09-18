import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const packageName = packageJson.name;
const entrypoints = Object.keys(packageJson.exports).map((exportPath) =>
  exportPath === '.' ? packageName : `${packageName}${exportPath.slice(1)}`
);
const peerDependencies = Object.keys(packageJson.peerDependencies ?? {});

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const stdout = error.stdout?.toString() ?? '';
    const stderr = error.stderr?.toString() ?? '';
    throw new Error(
      [`Command failed: ${command} ${args.join(' ')}`, stdout, stderr].filter(Boolean).join('\n')
    );
  }
}

function runNpm(args, cwd) {
  if (process.platform === 'win32') {
    return run('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], cwd);
  }
  return run('npm', args, cwd);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function setupConsumer(tempRoot, name, consumerPackage, probeName, probeContents, deps) {
  const consumerDir = path.join(tempRoot, name);
  await mkdir(consumerDir, { recursive: true });
  await writeJson(path.join(consumerDir, 'package.json'), consumerPackage);
  await writeFile(path.join(consumerDir, probeName), probeContents);
  runNpm(['install', '--silent', '--no-audit', '--no-fund', ...deps], consumerDir);
  return consumerDir;
}

const entrypointList = JSON.stringify(entrypoints);
const esmProbe = `
const entrypoints = ${entrypointList};

for (const entrypoint of entrypoints) {
  const module = await import(entrypoint);
  if (Object.keys(module).length === 0) {
    throw new Error(\`Packaged entrypoint has no runtime exports: \${entrypoint}\`);
  }
}
`;

const cjsProbe = `
const entrypoints = ${entrypointList};

for (const entrypoint of entrypoints) {
  const module = require(entrypoint);
  if (Object.keys(module).length === 0) {
    throw new Error(\`Packaged entrypoint has no runtime exports: \${entrypoint}\`);
  }
}
`;

const tsImports = entrypoints
  .map((entrypoint, index) => `import * as entrypoint${index} from '${entrypoint}';`)
  .join('\n');
const tsReferences = entrypoints.map((_, index) => `entrypoint${index}`).join(', ');
const tsProbe = `${tsImports}\n\nvoid [${tsReferences}];\n`;

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'a2a-js-pack-install-'));

try {
  const packOutput = runNpm(['pack', '--json', '--pack-destination', tempRoot], repoRoot);
  const [{ filename }] = JSON.parse(packOutput);
  const tarballPath = path.join(tempRoot, filename);
  const installDependencies = [tarballPath, ...peerDependencies];

  const esmDir = await setupConsumer(
    tempRoot,
    'esm-consumer',
    { name: 'esm-consumer', private: true, type: 'module' },
    'probe.mjs',
    esmProbe,
    installDependencies
  );
  run(process.execPath, ['probe.mjs'], esmDir);

  const cjsDir = await setupConsumer(
    tempRoot,
    'cjs-consumer',
    { name: 'cjs-consumer', private: true },
    'probe.cjs',
    cjsProbe,
    installDependencies
  );
  run(process.execPath, ['probe.cjs'], cjsDir);

  const tsDir = await setupConsumer(
    tempRoot,
    'ts-consumer',
    { name: 'ts-consumer', private: true, type: 'module' },
    'probe.ts',
    tsProbe,
    [...installDependencies, 'typescript']
  );
  await writeJson(path.join(tsDir, 'tsconfig.json'), {
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['probe.ts'],
  });
  runNpm(['exec', '--', 'tsc', '--project', 'tsconfig.json'], tsDir);

  console.log(
    `Packed package install/import checks passed for ${entrypoints.length} entrypoints in ESM, CJS, and TypeScript consumers.`
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

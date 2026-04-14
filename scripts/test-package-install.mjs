import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
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

async function setupConsumer(tempRoot, name, packageJson, probeName, probeContents, installDeps) {
  const consumerDir = path.join(tempRoot, name);
  await mkdir(consumerDir, { recursive: true });
  await writeJson(path.join(consumerDir, 'package.json'), packageJson);
  await writeFile(path.join(consumerDir, probeName), probeContents);
  runNpm(['install', '--silent', ...installDeps], consumerDir);
  return consumerDir;
}

const sharedProbeImports = `
const checks = {
  rootAgentCardPath: typeof AGENT_CARD_PATH === 'string',
  clientFactory: typeof ClientFactory === 'function',
  serverRequestHandler: typeof DefaultRequestHandler === 'function',
  expressHandler: typeof agentCardHandler === 'function',
  serverGrpcService: typeof grpcService === 'function',
  clientGrpcFactory: typeof GrpcTransportFactory === 'function',
};

if (!Object.values(checks).every(Boolean)) {
  throw new Error(\`Missing packaged entrypoint export: \${JSON.stringify(checks)}\`);
}
`;

const esmProbe = `
import { AGENT_CARD_PATH } from '@a2a-js/sdk';
import { ClientFactory } from '@a2a-js/sdk/client';
import { DefaultRequestHandler } from '@a2a-js/sdk/server';
import { agentCardHandler } from '@a2a-js/sdk/server/express';
import { grpcService } from '@a2a-js/sdk/server/grpc';
import { GrpcTransportFactory } from '@a2a-js/sdk/client/grpc';
${sharedProbeImports}
`;

const cjsProbe = `
const { AGENT_CARD_PATH } = require('@a2a-js/sdk');
const { ClientFactory } = require('@a2a-js/sdk/client');
const { DefaultRequestHandler } = require('@a2a-js/sdk/server');
const { agentCardHandler } = require('@a2a-js/sdk/server/express');
const { grpcService } = require('@a2a-js/sdk/server/grpc');
const { GrpcTransportFactory } = require('@a2a-js/sdk/client/grpc');
${sharedProbeImports}
`;

const tsProbe = `
import { AGENT_CARD_PATH } from '@a2a-js/sdk';
import { ClientFactory } from '@a2a-js/sdk/client';
import { DefaultRequestHandler } from '@a2a-js/sdk/server';
import { agentCardHandler } from '@a2a-js/sdk/server/express';
import { grpcService } from '@a2a-js/sdk/server/grpc';
import { GrpcTransportFactory } from '@a2a-js/sdk/client/grpc';

void AGENT_CARD_PATH;
void ClientFactory;
void DefaultRequestHandler;
void agentCardHandler;
void grpcService;
void GrpcTransportFactory;
`;

const peerDeps = ['express', '@grpc/grpc-js', '@bufbuild/protobuf'];

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'a2a-js-pack-install-'));

try {
  const packOutput = runNpm(['pack', '--json', '--pack-destination', tempRoot], repoRoot);
  const [{ filename }] = JSON.parse(packOutput);
  const tarballPath = path.join(tempRoot, filename);

  const esmDir = await setupConsumer(
    tempRoot,
    'esm-consumer',
    {
      name: 'esm-consumer',
      private: true,
      type: 'module',
    },
    'probe.mjs',
    esmProbe,
    [tarballPath, ...peerDeps]
  );
  run(process.execPath, ['probe.mjs'], esmDir);

  const cjsDir = await setupConsumer(
    tempRoot,
    'cjs-consumer',
    {
      name: 'cjs-consumer',
      private: true,
    },
    'probe.cjs',
    cjsProbe,
    [tarballPath, ...peerDeps]
  );
  run(process.execPath, ['probe.cjs'], cjsDir);

  const tsDir = await setupConsumer(
    tempRoot,
    'ts-consumer',
    {
      name: 'ts-consumer',
      private: true,
      type: 'module',
    },
    'probe.ts',
    tsProbe,
    [tarballPath, ...peerDeps, 'typescript']
  );
  await writeJson(path.join(tsDir, 'tsconfig.json'), {
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ['probe.ts'],
  });
  runNpm(['exec', '--', 'tsc', '--project', 'tsconfig.json'], tsDir);

  console.log(
    'Packed package install/import checks passed for ESM, CJS, and TypeScript consumers.'
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

import { ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Smoke test for the multi-transport-agent + cli.ts samples: boot the agent and
// drive the CLI against it over each transport. The samples are a separate
// workspace: run `npm run install:samples` once, then `npm run test:integration`.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLES_DIR = path.join(REPO_ROOT, 'src', 'samples');
const AGENT_SCRIPT = path.join(SAMPLES_DIR, 'agents', 'multi-transport-agent', 'index.ts');
const CLI_SCRIPT = path.join(SAMPLES_DIR, 'cli.ts');

const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;
const EXPECTED_REPLY = 'Hello World! Nice to meet you!';
const COMPLETED_MARKER = 'TASK_STATE_COMPLETED';
const TRANSPORTS = ['JSONRPC', 'HTTP+JSON', 'GRPC'] as const;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function runSample(scriptPath: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', scriptPath, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  child: ChildProcess
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Process exited (code ${child.exitCode}) while waiting for ${label}`);
    }
    if (predicate()) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out after ${READY_TIMEOUT_MS}ms waiting for ${label}`);
}

async function waitForAgentCard(url: string, agent: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (agent.exitCode != null) {
      throw new Error(`Agent exited (code ${agent.exitCode}) before becoming ready`);
    }
    // fetch throws ECONNREFUSED until the server is listening; poll past it.
    const ready = await fetch(url)
      .then((res) => res.ok)
      .catch(() => false);
    if (ready) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Agent did not become ready at ${url}`);
}

describe('samples smoke: multi-transport-agent + cli', () => {
  let agent: ChildProcess | undefined;
  let baseUrl: string;

  beforeAll(async () => {
    const [httpPort, grpcPort] = await Promise.all([freePort(), freePort()]);
    baseUrl = `http://127.0.0.1:${httpPort}`;

    agent = runSample(AGENT_SCRIPT, [], {
      HTTP_PORT: String(httpPort),
      GRPC_PORT: String(grpcPort),
    });
    // Surface the agent's own output so a boot failure shows why, not just a
    // generic "did not become ready".
    agent.stdout?.pipe(process.stdout);
    agent.stderr?.pipe(process.stderr);
    await waitForAgentCard(`${baseUrl}/.well-known/agent-card.json`, agent);
  });

  // The agent doesn't read stdin, so it won't self-terminate when the test
  // process exits; the CLI does, so it needs no explicit cleanup.
  afterAll(() => {
    agent?.kill();
  });

  describe.each(TRANSPORTS)('transport %s', (transport) => {
    it('round-trips a greeting', async () => {
      const output = await runCli(transport);
      expect(output, output).toContain(EXPECTED_REPLY);
      expect(output, output).toContain(COMPLETED_MARKER);
    });
  });

  async function runCli(transport: string): Promise<string> {
    const cli = runSample(CLI_SCRIPT, [`--transport=${transport}`, baseUrl], {});
    let output = '';
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };
    cli.stdout?.on('data', collect);
    cli.stderr?.on('data', collect);

    // Send the greeting only once connected, and wait for the terminal event
    // before `/exit`, otherwise readline closes the loop mid-request.
    await waitFor(() => output.includes('Connected via'), `${transport} to connect`, cli);
    cli.stdin?.write('hello\n');
    await waitFor(
      () => output.includes(EXPECTED_REPLY) && output.includes(COMPLETED_MARKER),
      `${transport} greeting reply`,
      cli
    );
    cli.stdin?.end('/exit\n');

    const [code] = (await once(cli, 'exit')) as [number | null];
    expect(code, output).toBe(0);
    return output;
  }
});

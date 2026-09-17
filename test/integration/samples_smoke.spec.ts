import { ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
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

/**
 * Runs the CLI with `args`, sends one greeting once it has connected, and
 * returns everything it printed. `done` says when the exchange is over: the
 * CLI must not be closed mid-request or readline tears down the loop.
 */
async function driveCli(
  args: string[],
  label: string,
  done: (output: string) => boolean
): Promise<string> {
  const cli = runSample(CLI_SCRIPT, args, {});
  let output = '';
  const collect = (chunk: Buffer): void => {
    output += chunk.toString('utf8');
  };
  cli.stdout?.on('data', collect);
  cli.stderr?.on('data', collect);

  await waitFor(() => output.includes('Connected via'), `${label} to connect`, cli);
  cli.stdin?.write('hello\n');
  await waitFor(() => done(output), `${label} response`, cli);
  cli.stdin?.end('/exit\n');

  const [code] = (await once(cli, 'exit')) as [number | null];
  expect(code, output).toBe(0);
  return output;
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
      const output = await driveCli(
        [`--transport=${transport}`, baseUrl],
        transport,
        (out) => out.includes(EXPECTED_REPLY) && out.includes(COMPLETED_MARKER)
      );
      expect(output, output).toContain(EXPECTED_REPLY);
      expect(output, output).toContain(COMPLETED_MARKER);
    });
  });
});

describe('samples smoke: cli service parameters', () => {
  it('sends --auth and --svc-param on discovery and on every request', async () => {
    // Stub agent: serves a card, records what it was called with, and fails the
    // message request — the CLI reports the error and stays in its loop.
    const requests: http.IncomingMessage[] = [];
    const server = http.createServer((req, res) => {
      requests.push(req);
      if (req.url?.includes('agent-card')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            name: 'Header Probe',
            supportedInterfaces: [
              { url: `http://${req.headers.host}`, protocolBinding: 'JSONRPC' },
            ],
          })
        );
        return;
      }
      res.statusCode = 500;
      res.end('{}');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as net.AddressInfo;

    try {
      await driveCli(
        ['--auth', 'Bearer test-token', '--svc-param', 'X-Demo=1', `http://127.0.0.1:${port}`],
        'probe',
        () => requests.some((req) => req.method === 'POST')
      );
    } finally {
      server.close();
    }

    // The card GET and the message POST take different paths through the CLI:
    // the resolver's fetch wrapper and per-call `serviceParameters`.
    expect(requests.map((req) => req.method)).toEqual(['GET', 'POST']);
    for (const req of requests) {
      expect(req.headers.authorization, req.url).toBe('Bearer test-token');
      expect(req.headers['x-demo'], req.url).toBe('1');
    }
  });
});

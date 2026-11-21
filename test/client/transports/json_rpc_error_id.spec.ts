import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { JsonRpcTransport } from '../../../src/client/transports/json_rpc_transport.js';
import { LegacyJsonRpcTransport } from '../../../src/compat/v0_3/client/transports/json_rpc_transport.js';
import { JsonRpcTaskNotFoundError } from '../../../src/errors/index.js';

const request = { id: 'task', tenant: '' };

describe.each([
  ['v1', JsonRpcTransport],
  ['v0.3', LegacyJsonRpcTransport],
])('%s JSON-RPC error correlation', (_version, Transport) => {
  it.each([
    ['unary', 200],
    ['unary', 400],
    ['stream preflight', 200],
    ['stream preflight', 400],
  ])('rejects a mismatched ID for %s HTTP %i', async (operation, status) => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 999,
            error: { code: -32001, message: 'wrong task' },
          }),
          { status, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const transport = new Transport({ endpoint: 'https://example.test', fetchImpl });
    const result =
      operation === 'unary'
        ? transport.getTask(request)
        : transport.resubscribeTask(request).next();
    await expect(result).rejects.toThrow(/response ID mismatch/);
  });

  it.each([null, 1])('accepts an error response with ID %s', async (id) => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32001, message: 'task not found' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const transport = new Transport({ endpoint: 'https://example.test', fetchImpl });
    await expect(transport.getTask(request)).rejects.toBeInstanceOf(JsonRpcTaskNotFoundError);
  });

  it.each([undefined, '1', {}, 0])('rejects an invalid error response ID %s', async (id) => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32001, message: 'task not found' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const transport = new Transport({ endpoint: 'https://example.test', fetchImpl });
    await expect(transport.getTask(request)).rejects.toThrow(/response ID mismatch/);
  });

  it.each([null, 1, 999])('validates SSE error ID %s', async (id) => {
    const event = { jsonrpc: '2.0', id, error: { code: -32001, message: 'task not found' } };
    const fetchImpl = vi.fn(
      async () =>
        new Response(`data: ${JSON.stringify(event)}\n\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
    );
    const transport = new Transport({ endpoint: 'https://example.test', fetchImpl });
    const result = transport.resubscribeTask(request).next();
    if (id === 999) await expect(result).rejects.toThrow(/response ID mismatch/);
    else await expect(result).rejects.toBeInstanceOf(JsonRpcTaskNotFoundError);
  });

  it('retains non-JSON-RPC middleware error handling', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: -32001, message: 'middleware error' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const transport = new Transport({ endpoint: 'https://example.test', fetchImpl });
    await expect(transport.resubscribeTask(request).next()).rejects.toBeInstanceOf(
      JsonRpcTaskNotFoundError
    );
  });

  it.each(['unary', 'stream'])('preserves a no-ID middleware error for %s', async (operation) => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32099, message: 'unauthenticated' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const transport = new Transport({ endpoint: 'https://example.test', fetchImpl });
    const result =
      operation === 'unary'
        ? transport.getTask(request)
        : transport.resubscribeTask(request).next();
    await expect(result).rejects.toMatchObject({
      message: 'unauthenticated',
      envelopeCode: -32099,
    });
  });

  it.skipIf('WebSocketPair' in globalThis).each(['unary', 'stream'])(
    'preserves a no-ID middleware error over HTTP for %s',
    async (operation) => {
      const server = createServer((_req, response) => {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32099, message: 'unauthenticated' } })
        );
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const { port } = server.address() as AddressInfo;
        const transport = new Transport({ endpoint: `http://127.0.0.1:${port}` });
        const result =
          operation === 'unary'
            ? transport.getTask(request)
            : transport.resubscribeTask(request).next();
        await expect(result).rejects.toMatchObject({
          message: 'unauthenticated',
          envelopeCode: -32099,
        });
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    }
  );
});

import { describe, expect, it } from 'vitest';
import { JsonRpcTransport } from '../../../src/client/transports/json_rpc_transport.js';
import { RestTransport } from '../../../src/client/transports/rest_transport.js';
import { parseSseStream } from '../../../src/sse_utils.js';

function responseFromChunks(text: string, chunkSize: number): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset = Math.min(offset + chunkSize, bytes.length);
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
}

describe.each(['JSONRPC', 'HTTP+JSON'])('%s SSE line endings', (protocol) => {
  for (const [name, delimiter] of [
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ]) {
    it.each([1, 2, 7, 4096])(`delivers two ${name} events with %i-byte chunks`, async (size) => {
      const fetchImpl: typeof fetch = async (_input, init) => {
        const requestId = protocol === 'JSONRPC' ? JSON.parse(String(init?.body)).id : null;
        const frames = ['task-1', 'task-2'].map((id) => {
          const result = {
            task: {
              id,
              contextId: 'ctx-Україна-🌍',
              status: { state: 'TASK_STATE_WORKING' },
            },
          };
          const body = protocol === 'JSONRPC' ? { jsonrpc: '2.0', id: requestId, result } : result;
          return `: heartbeat${delimiter}data: ${JSON.stringify(body)}${delimiter}${delimiter}`;
        });
        return responseFromChunks(frames.join(''), size);
      };
      const options = { endpoint: 'https://example.test/a2a', fetchImpl };
      const transport =
        protocol === 'JSONRPC' ? new JsonRpcTransport(options) : new RestTransport(options);
      const events = [];
      for await (const event of transport.resubscribeTask({ id: 'task-1', tenant: '' })) {
        events.push(event);
      }
      expect(events).toHaveLength(2);
      const tasks = events.map((event) => {
        expect(event.payload?.$case).toBe('task');
        return event.payload?.$case === 'task' ? event.payload.value : undefined;
      });
      expect(tasks.map((task) => task?.id)).toEqual(['task-1', 'task-2']);
      expect(tasks.map((task) => task?.contextId)).toEqual(['ctx-Україна-🌍', 'ctx-Україна-🌍']);
    });
  }
});

describe('SSE CR parser boundaries', () => {
  it.each([1, 2, 7, 4096])('handles mixed delimiters with %i-byte chunks', async (size) => {
    const response = responseFromChunks(
      'event: update\rdata: first\r\ndata: second\n\rdata: third\r\n\r\n',
      size
    );
    const events = [];
    for await (const event of parseSseStream(response)) events.push(event);
    expect(events).toEqual([
      { type: 'update', data: 'first\nsecond' },
      { type: 'message', data: 'third' },
    ]);
  });

  it('dispatches a CR-terminated event before EOF', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: ready\r\r'));
        },
      })
    );
    const stream = parseSseStream(response);
    try {
      expect(await stream.next()).toEqual({
        value: { type: 'message', data: 'ready' },
        done: false,
      });
    } finally {
      await stream.return();
    }
  });

  it('retains the event size limit for CR-delimited multiline data', async () => {
    const response = responseFromChunks('data: 1234\rdata: 5678\r\r', 1);
    const events = [];
    for await (const event of parseSseStream(response, 10)) events.push(event);
    expect(events).toEqual([{ type: 'message', data: '1234\n5678' }]);
    const oversized = responseFromChunks('data: 1234\rdata: 5678\rdata: 90\r\r', 1);
    await expect(async () => {
      for await (const event of parseSseStream(oversized, 10)) void event;
    }).rejects.toThrow('SSE event data exceeded');
  });
});

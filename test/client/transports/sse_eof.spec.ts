import { describe, expect, it } from 'vitest';
import { JsonRpcTransport } from '../../../src/client/transports/json_rpc_transport.js';
import { RestTransport } from '../../../src/client/transports/rest_transport.js';

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

describe.each(['JSONRPC', 'HTTP+JSON'])('%s SSE end of stream', (protocol) => {
  const cases = [
    {
      name: 'discards a data line without an event delimiter',
      suffix: '\n',
      first: false,
      expected: [],
    },
    {
      name: 'discards a data line without a line delimiter',
      suffix: '',
      first: false,
      expected: [],
    },
    {
      name: 'keeps the complete event before an incomplete event',
      suffix: '\n',
      first: true,
      expected: ['task-1'],
    },
    {
      name: 'delivers complete events',
      suffix: '\n\n',
      first: true,
      expected: ['task-1', 'task-2'],
    },
    {
      name: 'delivers a CRLF-terminated event',
      suffix: '\r\n\r\n',
      first: false,
      expected: ['task-2'],
    },
  ];
  for (const fixture of cases) {
    it.each([1, 4096])(`${fixture.name} with %i-byte chunks`, async (chunkSize) => {
      const fetchImpl: typeof fetch = async (_input, init) => {
        const requestId = protocol === 'JSONRPC' ? JSON.parse(String(init?.body)).id : null;
        function frame(id: string, suffix: string): string {
          const result = {
            task: {
              id,
              contextId: 'ctx-你好',
              status: { state: 'TASK_STATE_COMPLETED' },
            },
          };
          const body = protocol === 'JSONRPC' ? { jsonrpc: '2.0', id: requestId, result } : result;
          return `data: ${JSON.stringify(body)}${suffix}`;
        }
        const text =
          (fixture.first ? frame('task-1', '\n\n') : '') + frame('task-2', fixture.suffix);
        return responseFromChunks(text, chunkSize);
      };
      const options = { endpoint: 'https://example.test/a2a', fetchImpl };
      const transport =
        protocol === 'JSONRPC' ? new JsonRpcTransport(options) : new RestTransport(options);
      const events = [];
      for await (const event of transport.resubscribeTask({ id: 'task-1', tenant: '' }))
        events.push(event);
      expect(
        events.map((event) =>
          event.payload?.$case === 'task' ? event.payload.value.id : undefined
        )
      ).toEqual(fixture.expected);
    });
  }
});

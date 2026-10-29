import { describe, it, expect } from 'vitest';
import { formatSSEEvent, formatSSEErrorEvent, parseSseStream, SseEvent } from '../src/sse_utils.js';

const MOCK_CHUNK_SIZE = 2;

function createStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let chunkIndex = 0;
  return new ReadableStream({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(chunks[chunkIndex]);
        chunkIndex++;
      } else {
        controller.close();
      }
    },
  });
}

function encodeChunks(data: string): Uint8Array[] {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += MOCK_CHUNK_SIZE) {
    chunks.push(encoder.encode(data.slice(i, i + MOCK_CHUNK_SIZE)));
  }
  return chunks;
}

function createMockResponse(sseData: string): Response {
  const chunks = encodeChunks(sseData);
  return new Response(createStream(chunks), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// Simulates environments where ReadableStream async iteration is not supported.
// See https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream#browser_compatibility
function createMockResponseWithoutAsyncIterator(sseData: string): Response {
  const chunks = encodeChunks(sseData);
  const stream = createStream(chunks);

  const originalPipeThrough = stream.pipeThrough.bind(stream);
  stream.pipeThrough = function <T>(transform: ReadableWritablePair<T, Uint8Array>) {
    const result = originalPipeThrough(transform);
    delete result[Symbol.asyncIterator];
    return result;
  } as typeof stream.pipeThrough;

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// The teardown tests observe the leak fix by watching the source stream's
// `cancel` callback fire through `parseSseStream`'s internal
// `pipeThrough(TextDecoderStream)`. Some runtimes (notably the Cloudflare
// Workers test pool / workerd) do not propagate a TextDecoderStream cancel to
// the upstream source, so that signal is unobservable there even though the
// fix runs. Probe the capability once and gate the assertions on it — the
// leak matters most under Node/undici, where the probe passes.
async function cancelPropagatesThroughTextDecoder(): Promise<boolean> {
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled = true;
    },
  });
  // Mirror parseSseStream: pipe the response body through a TextDecoderStream.
  const body = new Response(source).body;
  if (!body) return false;
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  await reader.read();
  await reader.cancel().catch(() => {});
  return cancelled;
}
const CANCEL_PROPAGATES = await cancelPropagatesThroughTextDecoder();

describe('SSE Utils', () => {
  describe('formatSSEEvent', () => {
    it('should format a data event', () => {
      const event = { kind: 'message', text: 'Hello' };

      const formatted = formatSSEEvent(event);

      expect(formatted).toBe('data: {"kind":"message","text":"Hello"}\n\n');
    });

    it('should format complex objects', () => {
      const event = { nested: { value: 123 }, array: [1, 2, 3] };

      const formatted = formatSSEEvent(event);

      expect(formatted).toBe('data: {"nested":{"value":123},"array":[1,2,3]}\n\n');
    });
  });

  describe('formatSSEErrorEvent', () => {
    it('should format an error event with event type', () => {
      const error = { code: -32603, message: 'Internal error' };

      const formatted = formatSSEErrorEvent(error);

      expect(formatted).toBe('event: error\ndata: {"code":-32603,"message":"Internal error"}\n\n');
    });
  });

  describe.each([
    ['with native async iterator', createMockResponse],
    ['without native async iterator', createMockResponseWithoutAsyncIterator],
  ])('parseSseStream (%s)', (_, createResponse) => {
    it('should parse a single data event', async () => {
      const sseData = 'data: {"kind":"message"}\n\n';
      const response = createResponse(sseData);

      const events: SseEvent[] = [];
      for await (const event of parseSseStream(response)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('message');
      expect(events[0].data).toBe('{"kind":"message"}');
    });

    it('should parse an error event', async () => {
      const sseData = 'event: error\ndata: {"code":-32001}\n\n';
      const response = createResponse(sseData);

      const events: SseEvent[] = [];
      for await (const event of parseSseStream(response)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].data).toBe('{"code":-32001}');
    });

    it('should parse multiple events', async () => {
      const sseData = 'data: {"id":1}\n\ndata: {"id":2}\n\n';
      const response = createResponse(sseData);

      const events: SseEvent[] = [];
      for await (const event of parseSseStream(response)) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(JSON.parse(events[0].data)).toEqual({ id: 1 });
      expect(JSON.parse(events[1].data)).toEqual({ id: 2 });
    });

    it('joins multiple consecutive data: lines per the SSE spec', async () => {
      // Per the HTML SSE spec: when an event has more than one `data:`
      // field, the user-agent concatenates them with `\n`. This is what
      // pretty-printing JSON via sse_starlette (a2a-python) produces.
      const sseData = 'data: {\ndata:   "id": 1\ndata: }\n\n';
      const response = createResponse(sseData);

      const events: SseEvent[] = [];
      for await (const event of parseSseStream(response)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(JSON.parse(events[0].data)).toEqual({ id: 1 });
    });

    it('ignores SSE comment lines (lines starting with `:`)', async () => {
      // Per SSE: lines starting with `:` are comments / heartbeats and
      // must be ignored. Common with proxies (nginx) and Python ASGI
      // servers (sse_starlette) emitting `: ping\n\n` to keep
      // connections warm.
      const sseData = ': ping\ndata: {"id":1}\n\n: another\ndata: {"id":2}\n\n';
      const response = createResponse(sseData);

      const events: SseEvent[] = [];
      for await (const event of parseSseStream(response)) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(JSON.parse(events[0].data)).toEqual({ id: 1 });
      expect(JSON.parse(events[1].data)).toEqual({ id: 2 });
    });

    it('handles \\r\\n line endings', async () => {
      // Per the SSE spec, lines may end with `\r\n`, `\r`, or `\n`. Our
      // tokenizer splits on `\n` and strips an optional trailing `\r`
      // — this exercises the `\r`-stripping branch.
      const sseData = 'data: {"id":1}\r\n\r\n';
      const response = createResponse(sseData);

      const events: SseEvent[] = [];
      for await (const event of parseSseStream(response)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(JSON.parse(events[0].data)).toEqual({ id: 1 });
    });
  });

  describe('parseSseStream teardown', () => {
    it.runIf(CANCEL_PROPAGATES)(
      'cancels the underlying stream when the consumer stops early',
      async () => {
        // An early break must cancel the response body, not just release the lock.
        let sourceCancelled = false;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            // One event, then stay open — a long-lived SSE connection.
            controller.enqueue(new TextEncoder().encode('data: {"id":1}\n\n'));
          },
          cancel() {
            sourceCancelled = true;
          },
        });
        const response = new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        });

        const seen: SseEvent[] = [];
        for await (const event of parseSseStream(response)) {
          seen.push(event);
          break;
        }

        expect(seen).toHaveLength(1);
        expect(sourceCancelled).toBe(true);
      }
    );

    it.runIf(CANCEL_PROPAGATES)(
      'cancels the underlying stream when the consumer throws',
      async () => {
        let sourceCancelled = false;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"id":1}\n\n'));
          },
          cancel() {
            sourceCancelled = true;
          },
        });
        const response = new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        });

        await expect(
          (async () => {
            for await (const event of parseSseStream(response)) {
              expect(event.data).toBe('{"id":1}');
              throw new Error('consumer boom');
            }
          })()
        ).rejects.toThrow('consumer boom');

        expect(sourceCancelled).toBe(true);
      }
    );
  });

  describe('Symmetry: parser understands formatter output', () => {
    it('should parse what formatSSEEvent produces', async () => {
      const originalData = { kind: 'task', id: '123', status: 'completed' };
      const formatted = formatSSEEvent(originalData);
      const response = createMockResponse(formatted);

      const events: SseEvent[] = [];
      for await (const event of parseSseStream(response)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('message');
      expect(JSON.parse(events[0].data)).toEqual(originalData);
    });

    it('should parse what formatSSEErrorEvent produces', async () => {
      const originalError = { code: -32001, message: 'Task not found', data: { taskId: 'abc' } };
      const formatted = formatSSEErrorEvent(originalError);
      const response = createMockResponse(formatted);

      const events: SseEvent[] = [];
      for await (const event of parseSseStream(response)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(JSON.parse(events[0].data)).toEqual(originalError);
    });

    it('should parse multiple formatted events in sequence', async () => {
      const events_to_format = [
        { kind: 'status-update', status: 'working' },
        { kind: 'artifact', data: 'hello' },
        { kind: 'status-update', status: 'completed' },
      ];

      const formatted = events_to_format.map(formatSSEEvent).join('');
      const response = createMockResponse(formatted);

      const parsedEvents: SseEvent[] = [];
      for await (const event of parseSseStream(response)) {
        parsedEvents.push(event);
      }

      expect(parsedEvents).toHaveLength(3);
      for (let i = 0; i < events_to_format.length; i++) {
        expect(JSON.parse(parsedEvents[i].data)).toEqual(events_to_format[i]);
      }
    });

    it('should parse mixed data and error events', async () => {
      const dataEvent = { kind: 'message', text: 'hello' };
      const errorEvent = { code: -32603, message: 'Internal error' };

      const formatted = formatSSEEvent(dataEvent) + formatSSEErrorEvent(errorEvent);
      const response = createMockResponse(formatted);

      const parsedEvents: SseEvent[] = [];
      for await (const event of parseSseStream(response)) {
        parsedEvents.push(event);
      }

      expect(parsedEvents).toHaveLength(2);
      expect(parsedEvents[0].type).toBe('message');
      expect(JSON.parse(parsedEvents[0].data)).toEqual(dataEvent);
      expect(parsedEvents[1].type).toBe('error');
      expect(JSON.parse(parsedEvents[1].data)).toEqual(errorEvent);
    });
  });

  // A2A clients stream from remote, potentially untrusted servers. A hostile
  // server that never terminates a line — or an event — would grow an
  // in-memory buffer without bound (CWE-400). parseSseStream caps both.
  describe('parseSseStream size bound (DoS guard)', () => {
    async function drain(response: Response, maxEventSizeBytes?: number): Promise<SseEvent[]> {
      const events: SseEvent[] = [];
      for await (const event of parseSseStream(response, maxEventSizeBytes)) {
        events.push(event);
      }
      return events;
    }

    it('throws when a single line never terminates and exceeds the limit', async () => {
      // No newline anywhere: the residual partial line grows past the cap.
      const response = createMockResponse('data: ' + 'A'.repeat(1000));

      await expect(drain(response, 100)).rejects.toThrow(/SSE line exceeded the maximum/);
    });

    it('throws when an oversized line is terminated and arrives in one chunk', async () => {
      // Delivered whole so the newline is present before the residual check —
      // exercises the in-loop guard the residual check alone would miss.
      const stream = createStream([new TextEncoder().encode(': ' + 'A'.repeat(1000) + '\n')]);
      const response = new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      });

      await expect(drain(response, 100)).rejects.toThrow(/SSE line exceeded the maximum/);
    });

    it('throws when accumulated data lines exceed the limit before a blank line', async () => {
      // Many consecutive `data:` lines with no terminating blank line: the
      // joined event data grows past the cap.
      let sse = '';
      for (let i = 0; i < 200; i++) sse += `data: ${'A'.repeat(20)}\n`;
      const response = createMockResponse(sse);

      await expect(drain(response, 100)).rejects.toThrow(/SSE event data exceeded the maximum/);
    });

    it('parses a well-formed event that stays within the limit', async () => {
      const event = { kind: 'message', text: 'hello' };
      const response = createMockResponse(formatSSEEvent(event));

      const events = await drain(response, 1024);

      expect(events).toHaveLength(1);
      expect(JSON.parse(events[0].data)).toEqual(event);
    });
  });
});

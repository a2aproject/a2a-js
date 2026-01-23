import { describe, it, expect } from 'vitest';
import { formatSSEEvent, formatSSEErrorEvent, parseSseStream, SseEvent } from '../src/sse_utils.js';

const MOCK_CHUNK_SIZE = 2;

/**
 * Creates a ReadableStream from chunks of Uint8Array data.
 */
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

/**
 * Encodes a string into chunks of Uint8Array data.
 */
function encodeChunks(data: string): Uint8Array[] {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += MOCK_CHUNK_SIZE) {
    chunks.push(encoder.encode(data.slice(i, i + MOCK_CHUNK_SIZE)));
  }
  return chunks;
}

/**
 * Creates a mock Response object from SSE-formatted strings.
 * Used to test that the parser can understand what the formatter produces.
 */
function createMockResponse(sseData: string): Response {
  const chunks = encodeChunks(sseData);
  return new Response(createStream(chunks), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * Creates a mock Response where the decoded stream has no native async iterator.
 * Simulates environments where ReadableStream async iteration is not supported.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream#browser_compatibility
 */
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
});

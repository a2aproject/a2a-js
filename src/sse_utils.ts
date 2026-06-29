/**
 * Shared Server-Sent Events (SSE) utilities for both JSON-RPC and REST
 * transports.
 */

// ============================================================================
// SSE Headers
// ============================================================================

/** Standard HTTP headers for SSE streaming responses. */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no', // Disable buffering in nginx
} as const;

// ============================================================================
// SSE Event Types
// ============================================================================

/** A parsed SSE event with type and data. */
export interface SseEvent {
  type: string;
  data: string;
}

// ============================================================================
// SSE Event Formatting (Server-side)
// ============================================================================

/**
 * Formats a data event for the SSE protocol.
 *
 * @example
 * ```ts
 * formatSSEEvent({ kind: 'message', text: 'Hello' })
 * // "data: {\"kind\":\"message\",\"text\":\"Hello\"}\n\n"
 * ```
 */
export function formatSSEEvent(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Formats an error event for the SSE protocol, using the `error` event
 * type so clients can distinguish errors from data events.
 *
 * @example
 * ```ts
 * formatSSEErrorEvent({ code: -32603, message: 'Internal error' })
 * // "event: error\ndata: {\"code\":-32603,\"message\":\"Internal error\"}\n\n"
 * ```
 */
export function formatSSEErrorEvent(error: unknown): string {
  return `event: error\ndata: ${JSON.stringify(error)}\n\n`;
}

// ============================================================================
// SSE Event Parsing (Client-side)
// ============================================================================

/**
 * Parses an SSE stream from a `Response`, yielding events as they arrive.
 * Expects well-formed SSE events with single-line JSON data, matching the
 * format produced by {@link formatSSEEvent} and {@link formatSSEErrorEvent}.
 */
export async function* parseSseStream(
  response: Response
): AsyncGenerator<SseEvent, void, undefined> {
  if (!response.body) {
    throw new Error('SSE response body is undefined. Cannot read stream.');
  }

  let buffer = '';
  let eventType = 'message';
  let eventData = '';

  const stream = response.body.pipeThrough(new TextDecoderStream());

  for await (const value of readFrom(stream)) {
    buffer += value;
    let lineEndIndex: number;

    while ((lineEndIndex = buffer.indexOf('\n')) >= 0) {
      // Per the SSE spec lines may end with `\r\n`, `\r`, or `\n`. We
      // strip a trailing `\r` explicitly rather than calling `.trim()`,
      // which would also eat whitespace inside JSON-formatted `data:`
      // payloads.
      let line = buffer.substring(0, lineEndIndex);
      if (line.endsWith('\r')) line = line.substring(0, line.length - 1);
      buffer = buffer.substring(lineEndIndex + 1);

      if (line === '') {
        if (eventData) {
          yield { type: eventType, data: eventData };
          eventData = '';
          eventType = 'message';
        }
      } else if (line.startsWith(':')) {
        // Comment line per the SSE spec — ignored.
      } else if (line.startsWith('event:')) {
        eventType = stripOptionalLeadingSpace(line.substring('event:'.length));
      } else if (line.startsWith('data:')) {
        // Multiple consecutive `data:` lines within a single event are
        // joined by `\n` per the SSE spec. Some servers (e.g.
        // sse_starlette in a2a-python) pretty-print JSON across lines,
        // so append instead of overwriting.
        const fieldValue = stripOptionalLeadingSpace(line.substring('data:'.length));
        eventData = eventData === '' ? fieldValue : `${eventData}\n${fieldValue}`;
      }
    }
  }

  // Yield any pending event at stream end.
  if (eventData) {
    yield { type: eventType, data: eventData };
  }
}

/**
 * Per the SSE spec, the optional single leading space after the field-name
 * colon is consumed by the parser; embedded and trailing whitespace are
 * preserved.
 */
function stripOptionalLeadingSpace(value: string): string {
  return value.startsWith(' ') ? value.substring(1) : value;
}

/**
 * Reads string chunks from a `ReadableStream` using the reader API. We
 * use the manual reader rather than async iteration because the latter is
 * not supported on all runtimes.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream#browser_compatibility
 */
async function* readFrom(stream: ReadableStream<string>): AsyncGenerator<string, void, void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

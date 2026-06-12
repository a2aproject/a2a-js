/**
 * Shared Server-Sent Events (SSE) utilities for both JSON-RPC and REST transports.
 * This module provides common SSE formatting and parsing functions.
 */

// ============================================================================
// SSE Headers
// ============================================================================

/**
 * Standard HTTP headers for Server-Sent Events (SSE) streaming responses.
 * These headers ensure proper SSE behavior across different proxies and clients.
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no', // Disable buffering in nginx
} as const;

// ============================================================================
// SSE Event Types
// ============================================================================

/**
 * Represents a parsed SSE event with type and data.
 */
export interface SseEvent {
  type: string;
  data: string;
}

// ============================================================================
// SSE Event Formatting (Server-side)
// ============================================================================

/**
 * Formats a data event for Server-Sent Events (SSE) protocol.
 * Creates a standard SSE event with an ID and JSON-stringified data.
 *
 * @param event - The event data to send (will be JSON stringified)
 * @returns Formatted SSE event string following the SSE specification
 *
 * @example
 * ```ts
 * formatSSEEvent({ kind: 'message', text: 'Hello' })
 * // Returns: "data: {\"kind\":\"message\",\"text\":\"Hello\"}\n\n"
 *
 * formatSSEEvent({ result: 'success' }, 'custom-id')
 * // Returns: "data: {\"result\":\"success\"}\n\n"
 * ```
 */
export function formatSSEEvent(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Formats an error event for Server-Sent Events (SSE) protocol.
 * Error events use the "error" event type to distinguish them from data events,
 * allowing clients to handle errors differently.
 *
 * @param error - The error object (will be JSON stringified)
 * @returns Formatted SSE error event string with custom event type
 *
 * @example
 * ```ts
 * formatSSEErrorEvent({ code: -32603, message: 'Internal error' })
 * // Returns: "event: error\ndata: {\"code\":-32603,\"message\":\"Internal error\"}\n\n"
 * ```
 */
export function formatSSEErrorEvent(error: unknown): string {
  return `event: error\ndata: ${JSON.stringify(error)}\n\n`;
}

// ============================================================================
// SSE Event Parsing (Client-side)
// ============================================================================

/**
 * Parses a Server-Sent Events (SSE) stream from a Response object.
 * Yields parsed SSE events as they arrive.
 *
 * This parser expects well-formed SSE events with single-line JSON data,
 * matching the format produced by formatSSEEvent and formatSSEErrorEvent.
 *
 * @param response - The fetch Response containing an SSE stream
 * @yields SseEvent objects with type and data fields
 *
 * @example
 * ```ts
 * for await (const event of parseSseStream(response)) {
 *   if (event.type === 'error') {
 *     handleError(JSON.parse(event.data));
 *   } else {
 *     handleData(JSON.parse(event.data));
 *   }
 * }
 * ```
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
      // Per SSE spec a single trailing `\r` on the line is also a
      // line terminator (lines may end with `\r\n`, `\r`, or `\n`).
      // Strip the trailing `\r` here rather than calling `.trim()`,
      // which would also eat leading/trailing whitespace inside the
      // field value (e.g. a JSON-formatted `data:` line whose
      // content starts with a space). The `data:` parser below
      // already handles the spec-required optional single space
      // after the colon.
      let line = buffer.substring(0, lineEndIndex);
      if (line.endsWith('\r')) line = line.substring(0, line.length - 1);
      buffer = buffer.substring(lineEndIndex + 1);

      if (line === '') {
        // Empty line signals end of event
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
        // Per the SSE spec, multiple consecutive `data:` lines within
        // a single event are joined by `\n`. Server implementations
        // (e.g. sse_starlette in a2a-python) take advantage of this
        // to pretty-print JSON payloads across multiple lines. Append
        // instead of overwriting to preserve the full payload.
        const fieldValue = stripOptionalLeadingSpace(line.substring('data:'.length));
        eventData = eventData === '' ? fieldValue : `${eventData}\n${fieldValue}`;
      }
    }
  }

  // Yield any pending event at stream end
  if (eventData) {
    yield { type: eventType, data: eventData };
  }
}

/**
 * Per the SSE spec (HTML Living Standard, §9.2.6), the optional single
 * leading space after the field-name colon is consumed by the parser.
 * Trailing whitespace and embedded whitespace are preserved.
 */
function stripOptionalLeadingSpace(value: string): string {
  return value.startsWith(' ') ? value.substring(1) : value;
}

/**
 * Reads string chunks from a ReadableStream using the reader API.
 *
 * We use the manual reader approach the native async iterator directly on the stream
 * because ReadableStream async iteration is not supported in all environments.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream#browser_compatibility
 *
 * @param stream - The ReadableStream to read from
 * @yields String chunks from the stream
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

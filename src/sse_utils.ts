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
 * Upper bound on how large a single unterminated line or a single SSE event
 * may grow before {@link parseSseStream} aborts. Measured in UTF-16 code
 * units (JS string length), which equals byte length for ASCII payloads such
 * as JSON-encoded events; memory stays bounded within a small constant
 * factor of this value either way.
 *
 * A2A clients stream from remote, potentially untrusted agent servers.
 * Without this cap a malicious or broken server can stream bytes that never
 * form a complete line — or `data:` lines whose blank-line terminator never
 * arrives — growing an in-memory buffer without limit until the client
 * process exhausts memory (CWE-400, uncontrolled resource consumption).
 *
 * Realistic A2A events (Message/Task JSON) are KB-scale, and large files
 * should be referenced via `FileWithUri` parts rather than inlined, so the
 * 4 MiB default (matching gRPC's default max message size) leaves ample
 * headroom. Callers that must inline larger payloads can raise it via the
 * `maxEventSizeBytes` argument.
 */
export const DEFAULT_MAX_SSE_EVENT_SIZE_BYTES = 4 * 1024 * 1024; // 4 MiB

/**
 * Parses an SSE stream from a `Response`, yielding events as they arrive.
 * Expects well-formed SSE events with single-line JSON data, matching the
 * format produced by {@link formatSSEEvent} and {@link formatSSEErrorEvent}.
 *
 * @param maxEventSizeBytes - Aborts the stream if a single line or event
 *   exceeds this size, bounding memory against a hostile server. Defaults to
 *   {@link DEFAULT_MAX_SSE_EVENT_SIZE_BYTES}.
 */
export async function* parseSseStream(
  response: Response,
  maxEventSizeBytes: number = DEFAULT_MAX_SSE_EVENT_SIZE_BYTES
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
      if (lineEndIndex > maxEventSizeBytes) {
        throw sseSizeError('SSE line', maxEventSizeBytes);
      }
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
        if (eventData.length > maxEventSizeBytes) {
          throw sseSizeError('SSE event data', maxEventSizeBytes);
        }
      }
    }

    // Same cap for a line that never terminates: the loop above never runs,
    // so the residual buffer would otherwise grow without bound.
    if (buffer.length > maxEventSizeBytes) {
      throw sseSizeError('SSE line', maxEventSizeBytes);
    }
  }

  // Yield any pending event at stream end.
  if (eventData) {
    yield { type: eventType, data: eventData };
  }
}

function sseSizeError(what: string, maxEventSizeBytes: number): Error {
  return new Error(
    `${what} exceeded the maximum allowed size of ${maxEventSizeBytes} bytes. ` +
      `Pass maxEventSizeBytes to raise the limit, or prefer FileWithUri parts for large payloads.`
  );
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
    // `releaseLock()` alone leaves the body un-cancelled, leaking the
    // connection when a consumer breaks/throws early. `.catch()` swallows the
    // rejection cancel() produces on an already-errored stream.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

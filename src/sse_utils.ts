/**
 * Shared Server-Sent Events (SSE) utilities for both JSON-RPC and REST transports.
 * This module provides common SSE formatting functions and headers.
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
// SSE Event Formatting
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

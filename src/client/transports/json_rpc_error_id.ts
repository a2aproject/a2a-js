import type { JSONRPCErrorResponse } from '../../core.js';

/** Validate correlation for JSON-RPC errors, allowing null when the server could not identify the request. */
export function assertJsonRpcErrorId(
  response: JSONRPCErrorResponse,
  requestId: string | number | null,
  context: string
): void {
  if (response.id !== null && response.id !== requestId) {
    throw new Error(
      `JSON-RPC response ID mismatch for ${context}. Expected ${requestId}, got ${response.id}.`
    );
  }
}

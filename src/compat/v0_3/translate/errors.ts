/**
 * Error translator between v1.0 SDK errors and v0.3 wire shapes.
 *
 * v1.0 introduced an enriched error model — a `google.rpc.Status`-style
 * envelope with a `details[]` array carrying typed `ErrorInfo` payloads
 * (`@type`, `reason`, `domain`, `metadata`). v0.3 predates that model
 * and uses simpler shapes:
 *
 *   - JSON-RPC:   `{ code, message, data? }`     — `data` is a plain
 *                                                   `Record<string, unknown>`,
 *                                                   not an array of typed
 *                                                   details.
 *   - REST:       `{ code, message, data? }`     — a bare object, no
 *                                                   outer `{ error: … }`
 *                                                   wrapper, no `status`
 *                                                   field, no `details[]`.
 *
 * Both shapes are structurally identical, so a single converter
 * ({@link toCompatErrorBody}) serves both transports.
 *
 * The v0.3 gRPC handler intentionally does NOT use this module: it still
 * attaches `google.rpc.ErrorInfo` in the `grpc-status-details-bin`
 * trailer because the binary trailer is invisible to v0.3 clients
 * (which do not decode it) yet still useful to v1.0-aware clients
 * talking to a v0.3 server. See
 * `src/compat/v0_3/server/grpc/grpc_service.ts` for the rationale.
 *
 * Codes introduced in v1.0 (`-32005`, `-32006`, `-32008`, `-32009`) that
 * have no v0.3 spec equivalent are passed through with their numeric
 * code unchanged. v0.3 clients seeing an unknown `-32xxx` should treat
 * it as an opaque internal error. This is a deliberate decision over
 * collapsing them to `INTERNAL_ERROR` — it preserves debuggability for
 * v0.3 clients that happen to recognise the new codes.
 */

import { A2A_ERROR_CLASS_TO_CODE, A2A_ERROR_CODE } from '../../../errors.js';
import { A2AError as LegacyA2AError } from '../server/error.js';
import type { JSONRPCError } from '../types/types.js';

/**
 * v0.3-shaped HTTP error body.
 *
 * The v0.3 reference implementation returned errors as a bare
 * `{ code, message, data? }` object (no `details[]` array, no `status`
 * field, no outer `{ error: {...} }` wrapper). v1.0 introduced the
 * structured `google.rpc.Status` JSON envelope, so this shape is kept
 * separate to preserve wire-compatibility with v0.3 clients.
 */
export interface LegacyRestErrorBody {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Internal helper: resolves any value thrown by user code into the
 * `{ code, message, data? }` triple that both v0.3 wire shapes need.
 *
 *  1. {@link LegacyA2AError} instances are honoured verbatim — their
 *     `code`, `message`, and `data` are surfaced as-is. This is the
 *     escape hatch for code that wants full control of the v0.3
 *     envelope (e.g. setting a custom `data` payload that v0.3 clients
 *     can read).
 *  2. v1.0 SDK error classes (`TaskNotFoundError`, …) are mapped to
 *     their corresponding numeric codes via
 *     {@link A2A_ERROR_CLASS_TO_CODE}. **The `data` field is omitted**
 *     even when the v1.0 path would have attached an `ErrorInfo`
 *     payload — this is the v1.0 → v0.3 wire-shape demotion.
 *  3. Anything else (unknown `Error` subclass, non-`Error` throw)
 *     becomes a generic `INTERNAL_ERROR` with a best-effort message.
 */
function demoteToLegacyShape(error: unknown): {
  code: number;
  message: string;
  data?: Record<string, unknown>;
} {
  if (error instanceof LegacyA2AError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.data !== undefined ? { data: error.data } : {}),
    };
  }
  if (error instanceof Error) {
    const code = A2A_ERROR_CLASS_TO_CODE[error.name];
    if (code !== undefined) {
      return { code, message: error.message };
    }
  }
  const message = (error instanceof Error && error.message) || 'An unexpected error occurred.';
  return { code: A2A_ERROR_CODE.INTERNAL_ERROR, message };
}

/**
 * Converts any error to a v0.3-shaped error body.
 *
 * The returned object satisfies both the v0.3 JSON-RPC `JSONRPCError`
 * shape (used as the `error` field of
 * {@link import('../types/types.js').JSONRPCErrorResponse}) and the
 * v0.3 REST {@link LegacyRestErrorBody} shape. The two were
 * historically separate types but are structurally identical
 * (`{ code, message, data? }`), so a single converter serves both
 * transports.
 *
 * Crucially, the returned object never carries the v1.0 enriched
 * `details[]` array or any `ErrorInfo` payload — only `code`,
 * `message`, and (when honouring a {@link LegacyA2AError}) `data`.
 */
export function toCompatErrorBody(error: unknown): JSONRPCError | LegacyRestErrorBody {
  const { code, message, data } = demoteToLegacyShape(error);
  return {
    code,
    message,
    ...(data !== undefined ? { data } : {}),
  };
}

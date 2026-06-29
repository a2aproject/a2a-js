/**
 * Error translator from v1.0 SDK errors to v0.3 wire shapes. v0.3
 * JSON-RPC and REST both use a bare `{ code, message, data? }` body
 * (no `details[]`, no outer `{ error }` wrapper, no `status` field),
 * so one converter serves both.
 *
 * v1.0-only error codes are passed through with their numeric code
 * unchanged rather than collapsed to `INTERNAL_ERROR` — preserves
 * debuggability for v0.3 clients that happen to recognise them.
 *
 * The v0.3 gRPC handler doesn't use this module; it keeps emitting
 * `google.rpc.ErrorInfo` in `grpc-status-details-bin` for v1.0-aware
 * clients (see `server/grpc/grpc_service.ts`).
 */

import { A2A_ERROR_CLASS_TO_CODE, A2A_ERROR_CODE } from '../../../errors.js';
import { A2AError as LegacyA2AError } from '../server/error.js';
import type { JSONRPCError } from '../types/types.js';

/** v0.3 REST error body: bare `{ code, message, data? }`. */
export interface LegacyRestErrorBody {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Resolves any thrown value into a `{ code, message, data? }` triple.
 * Honours `LegacyA2AError` verbatim, maps known v1.0 SDK error classes
 * to their numeric codes (dropping `details[]`/`ErrorInfo`), and falls
 * back to `INTERNAL_ERROR` for everything else.
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
 * Converts any error to a v0.3-shaped body. Satisfies both the JSON-RPC
 * `JSONRPCError` and REST `LegacyRestErrorBody` shapes (structurally
 * identical). Never carries v1.0 `details[]` / `ErrorInfo`.
 */
export function toCompatErrorBody(error: unknown): JSONRPCError | LegacyRestErrorBody {
  const { code, message, data } = demoteToLegacyShape(error);
  return {
    code,
    message,
    ...(data !== undefined ? { data } : {}),
  };
}

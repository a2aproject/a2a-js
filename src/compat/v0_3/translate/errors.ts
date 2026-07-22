/**
 * Error translator to v0.3 wire shapes. v0.3 JSON-RPC and REST both
 * use a bare `{ code, message, data? }` body (no `details[]`, no outer
 * `{ error }` wrapper, no `status` field), so one converter serves
 * both.
 *
 * `JsonRpc*Error` instances preserve their `envelopeCode`, so wire
 * codes like `PARSE_ERROR`, `INVALID_REQUEST`, and `METHOD_NOT_FOUND`
 * survive the trip through the compat layer even though they have no
 * v1.0 semantic class.
 *
 * The v0.3 gRPC handler doesn't use this module; it keeps emitting
 * `google.rpc.ErrorInfo` in `grpc-status-details-bin` for v1.0-aware
 * clients (see `server/grpc/grpc_service.ts`).
 */

import { A2A_ERROR_CODE, isJsonRpcError, JSON_RPC_ERROR_CODE } from '../../../errors/json_rpc.js';
import { A2AError } from '../../../errors/index.js';
import type { JSONRPCError } from '../types/types.js';

/** v0.3 REST error body: bare `{ code, message, data? }`. */
export interface LegacyRestErrorBody {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Converts any error to a v0.3-shaped body. Satisfies both the JSON-RPC
 * `JSONRPCError` and REST `LegacyRestErrorBody` shapes (structurally
 * identical). Drops the v1.0 `details[]` / `ErrorInfo` — v0.3 clients
 * don't consume them.
 */
export function toCompatErrorBody(error: unknown): JSONRPCError | LegacyRestErrorBody {
  if (isJsonRpcError(error)) {
    return {
      code: error.envelopeCode,
      message: error.message,
      ...(error.data !== undefined ? { data: error.data as Record<string, unknown> } : {}),
    };
  }
  if (error instanceof A2AError) {
    const code = JSON_RPC_ERROR_CODE[error.name] ?? A2A_ERROR_CODE.INTERNAL_ERROR;
    return { code, message: error.message };
  }
  const message = (error instanceof Error && error.message) || 'An unexpected error occurred.';
  return { code: A2A_ERROR_CODE.INTERNAL_ERROR, message };
}

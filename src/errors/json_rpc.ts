/**
 * JSON-RPC transport error subclasses and envelope helpers.
 *
 * Owns the JSON-RPC 2.0 code namespace ({@link A2A_ERROR_CODE}) and
 * the per-error code mapping (§5.4). `./base.ts` intentionally
 * carries only §3.3.2 fields; codes are transport-specific.
 */

import type { JSONRPCError, JSONRPCErrorResponse } from '../core.js';
import {
  A2A_ERROR_CLASSES,
  A2A_ERROR_SPECS,
  A2AError,
  type A2AErrorOptions,
  type ErrorDetail,
} from './base.js';

/** JSON-RPC 2.0 error codes reserved for A2A. */
export const A2A_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  EXTENDED_CARD_NOT_CONFIGURED: -32007,
  EXTENSION_SUPPORT_REQUIRED: -32008,
  VERSION_NOT_SUPPORTED: -32009,
} as const;

/**
 * Per-error JSON-RPC envelope code (§5.4). Semantic class name -> code.
 */
export const JSON_RPC_ERROR_CODE: Readonly<Record<string, number>> = Object.freeze({
  TaskNotFoundError: A2A_ERROR_CODE.TASK_NOT_FOUND,
  TaskNotCancelableError: A2A_ERROR_CODE.TASK_NOT_CANCELABLE,
  PushNotificationNotSupportedError: A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED,
  UnsupportedOperationError: A2A_ERROR_CODE.UNSUPPORTED_OPERATION,
  ContentTypeNotSupportedError: A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED,
  InvalidAgentResponseError: A2A_ERROR_CODE.INVALID_AGENT_RESPONSE,
  ExtendedAgentCardNotConfiguredError: A2A_ERROR_CODE.EXTENDED_CARD_NOT_CONFIGURED,
  ExtensionSupportRequiredError: A2A_ERROR_CODE.EXTENSION_SUPPORT_REQUIRED,
  VersionNotSupportedError: A2A_ERROR_CODE.VERSION_NOT_SUPPORTED,
  RequestMalformedError: A2A_ERROR_CODE.INVALID_PARAMS,
});

/** Reverse of {@link JSON_RPC_ERROR_CODE}: envelope code -> class name. */
export const JSON_RPC_CODE_TO_ERROR: Readonly<Record<number, string>> = Object.freeze(
  Object.fromEntries(Object.entries(JSON_RPC_ERROR_CODE).map(([name, code]) => [code, name]))
);

/** Transport context carried by every `JsonRpc*Error`. */
export interface JsonRpcA2AError extends A2AError {
  readonly transport: 'jsonrpc';
  readonly envelopeCode: number;
  readonly data?: JSONRPCError['data'];
}

/** Options accepted by every `JsonRpc*Error` constructor. */
export interface JsonRpcA2AErrorOptions extends A2AErrorOptions {
  /** Envelope `error.code`. Defaults to the per-error spec value. */
  envelopeCode?: number;
  /** Envelope `error.data`, if any. */
  data?: JSONRPCError['data'];
}

/** Type guard narrowing an unknown / `A2AError` to {@link JsonRpcA2AError}. */
export function isJsonRpcError(err: unknown): err is JsonRpcA2AError {
  return err instanceof A2AError && (err as { transport?: string }).transport === 'jsonrpc';
}

function makeJsonRpc(name: string): new (options?: JsonRpcA2AErrorOptions) => JsonRpcA2AError {
  const Base = A2A_ERROR_CLASSES[name];
  const defaultCode = JSON_RPC_ERROR_CODE[name] ?? A2A_ERROR_CODE.INTERNAL_ERROR;
  const cls = {
    [`JsonRpc${name}`]: class extends Base {
      public readonly transport = 'jsonrpc';
      public readonly envelopeCode: number;
      public readonly data?: JSONRPCError['data'];
      constructor(options?: JsonRpcA2AErrorOptions) {
        super(options);
        this.name = name;
        this.envelopeCode = options?.envelopeCode ?? defaultCode;
        if (options?.data !== undefined) this.data = options.data;
      }
    },
  }[`JsonRpc${name}`];
  return cls as unknown as new (options?: JsonRpcA2AErrorOptions) => JsonRpcA2AError;
}

export const JsonRpcTaskNotFoundError = makeJsonRpc('TaskNotFoundError');
export type JsonRpcTaskNotFoundError = InstanceType<typeof JsonRpcTaskNotFoundError>;

export const JsonRpcTaskNotCancelableError = makeJsonRpc('TaskNotCancelableError');
export type JsonRpcTaskNotCancelableError = InstanceType<typeof JsonRpcTaskNotCancelableError>;

export const JsonRpcPushNotificationNotSupportedError = makeJsonRpc(
  'PushNotificationNotSupportedError'
);
export type JsonRpcPushNotificationNotSupportedError = InstanceType<
  typeof JsonRpcPushNotificationNotSupportedError
>;

export const JsonRpcUnsupportedOperationError = makeJsonRpc('UnsupportedOperationError');
export type JsonRpcUnsupportedOperationError = InstanceType<
  typeof JsonRpcUnsupportedOperationError
>;

export const JsonRpcContentTypeNotSupportedError = makeJsonRpc('ContentTypeNotSupportedError');
export type JsonRpcContentTypeNotSupportedError = InstanceType<
  typeof JsonRpcContentTypeNotSupportedError
>;

export const JsonRpcInvalidAgentResponseError = makeJsonRpc('InvalidAgentResponseError');
export type JsonRpcInvalidAgentResponseError = InstanceType<
  typeof JsonRpcInvalidAgentResponseError
>;

export const JsonRpcExtendedAgentCardNotConfiguredError = makeJsonRpc(
  'ExtendedAgentCardNotConfiguredError'
);
export type JsonRpcExtendedAgentCardNotConfiguredError = InstanceType<
  typeof JsonRpcExtendedAgentCardNotConfiguredError
>;

export const JsonRpcExtensionSupportRequiredError = makeJsonRpc('ExtensionSupportRequiredError');
export type JsonRpcExtensionSupportRequiredError = InstanceType<
  typeof JsonRpcExtensionSupportRequiredError
>;

export const JsonRpcVersionNotSupportedError = makeJsonRpc('VersionNotSupportedError');
export type JsonRpcVersionNotSupportedError = InstanceType<typeof JsonRpcVersionNotSupportedError>;

export const JsonRpcRequestMalformedError = makeJsonRpc('RequestMalformedError');
export type JsonRpcRequestMalformedError = InstanceType<typeof JsonRpcRequestMalformedError>;

/** JSON-RPC twins indexed by their semantic parent's name. */
export const JSON_RPC_ERROR_CLASSES: Readonly<
  Record<string, new (options?: JsonRpcA2AErrorOptions) => JsonRpcA2AError>
> = Object.freeze({
  TaskNotFoundError: JsonRpcTaskNotFoundError,
  TaskNotCancelableError: JsonRpcTaskNotCancelableError,
  PushNotificationNotSupportedError: JsonRpcPushNotificationNotSupportedError,
  UnsupportedOperationError: JsonRpcUnsupportedOperationError,
  ContentTypeNotSupportedError: JsonRpcContentTypeNotSupportedError,
  InvalidAgentResponseError: JsonRpcInvalidAgentResponseError,
  ExtendedAgentCardNotConfiguredError: JsonRpcExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError: JsonRpcExtensionSupportRequiredError,
  VersionNotSupportedError: JsonRpcVersionNotSupportedError,
  RequestMalformedError: JsonRpcRequestMalformedError,
});

/**
 * Envelope for a JSON-RPC error not covered by any semantic code (e.g.
 * `METHOD_NOT_FOUND`, `PARSE_ERROR`, or a custom vendor code). Concrete
 * {@link A2AError} carrying the full envelope; satisfies the
 * {@link JsonRpcA2AError} interface for `isJsonRpcError` narrowing.
 */
export class JsonRpcTransportError extends A2AError implements JsonRpcA2AError {
  public readonly transport = 'jsonrpc';
  public readonly envelopeCode: number;
  public readonly data?: JSONRPCError['data'];
  public readonly errorResponse: JSONRPCErrorResponse;
  constructor(envelope: JSONRPCErrorResponse) {
    super({ message: envelope.error.message });
    this.name = 'JsonRpcTransportError';
    this.envelopeCode = envelope.error.code;
    if (envelope.error.data !== undefined) this.data = envelope.error.data;
    this.errorResponse = envelope;
  }
}

/**
 * Serializes an error to a JSON-RPC `error` envelope. Includes
 * `google.rpc.ErrorInfo` in `data[]` for semantic errors. If the error
 * is a `JsonRpc*Error`, its `envelopeCode` overrides the semantic
 * default — used by the v0.3 compat layer to preserve wire codes like
 * `PARSE_ERROR` / `METHOD_NOT_FOUND` that don't map to any semantic
 * class.
 */
export function toJsonRpcError(error: unknown): {
  code: number;
  message: string;
  data?: ErrorDetail[];
} {
  if (isJsonRpcError(error)) {
    const spec = A2A_ERROR_SPECS[error.name];
    return {
      code: error.envelopeCode,
      message: error.message,
      ...(spec ? { data: [error.toErrorInfo()] } : {}),
    };
  }
  if (error instanceof A2AError) {
    const code = JSON_RPC_ERROR_CODE[error.name] ?? A2A_ERROR_CODE.INTERNAL_ERROR;
    return { code, message: error.message, data: [error.toErrorInfo()] };
  }
  const message = (error instanceof Error && error.message) || 'An unexpected error occurred.';
  return { code: A2A_ERROR_CODE.INTERNAL_ERROR, message };
}

/**
 * JSON-RPC reserved codes without a dedicated semantic class. Map to
 * the closest semantic twin so callers can still `instanceof
 * RequestMalformedError` etc.
 */
const RESERVED_CODE_TO_SEMANTIC: Readonly<Record<number, string>> = {
  [A2A_ERROR_CODE.PARSE_ERROR]: 'RequestMalformedError',
  [A2A_ERROR_CODE.INVALID_REQUEST]: 'RequestMalformedError',
  [A2A_ERROR_CODE.METHOD_NOT_FOUND]: 'RequestMalformedError',
};

/**
 * Rebuilds a semantic JSON-RPC error from a received envelope. Unknown
 * codes yield a {@link JsonRpcTransportError} carrying the full envelope.
 */
export function fromJsonRpcErrorResponse(response: JSONRPCErrorResponse): JsonRpcA2AError {
  const semanticName =
    JSON_RPC_CODE_TO_ERROR[response.error.code] ?? RESERVED_CODE_TO_SEMANTIC[response.error.code];
  if (semanticName) {
    return new JSON_RPC_ERROR_CLASSES[semanticName]({
      message: response.error.message,
      envelopeCode: response.error.code,
      data: response.error.data,
    });
  }
  return new JsonRpcTransportError(response);
}

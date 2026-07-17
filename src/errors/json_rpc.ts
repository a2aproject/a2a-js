/**
 * JSON-RPC transport error subclasses and envelope helpers.
 */

import type { JSONRPCError, JSONRPCErrorResponse } from '../core.js';
import {
  A2A_ERROR_CLASSES,
  A2A_ERROR_CODE,
  A2A_ERROR_SPECS,
  A2A_ERROR_SPECS_BY_CODE,
  A2AError,
  type A2AErrorOptions,
  type ErrorDetail,
} from './base.js';

/** Transport context carried by every `JsonRpc*Error`. */
export interface JsonRpcA2AError extends A2AError {
  readonly transport: 'jsonrpc';
  readonly envelopeCode: number;
  readonly data?: JSONRPCError['data'];
}

/** Options accepted by every `JsonRpc*Error` constructor. */
export interface JsonRpcA2AErrorOptions extends A2AErrorOptions {
  /** Envelope `error.code`. Defaults to the semantic error's spec value. */
  envelopeCode?: number;
  /** Envelope `error.data`, if any. */
  data?: JSONRPCError['data'];
}

/** Type guard narrowing an unknown / `A2AError` to {@link JsonRpcA2AError}. */
export function isJsonRpcError(err: unknown): err is JsonRpcA2AError {
  return err instanceof A2AError && (err as { transport?: string }).transport === 'jsonrpc';
}

function makeJsonRpc(name: string): new (options?: JsonRpcA2AErrorOptions) => JsonRpcA2AError {
  const spec = A2A_ERROR_SPECS[name];
  const Base = A2A_ERROR_CLASSES[name];
  const cls = {
    [`JsonRpc${name}`]: class extends Base {
      public readonly transport = 'jsonrpc';
      public readonly envelopeCode: number;
      public readonly data?: JSONRPCError['data'];
      constructor(options?: JsonRpcA2AErrorOptions) {
        super(options);
        this.name = name;
        this.envelopeCode = options?.envelopeCode ?? spec.code;
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

export const JsonRpcGenericError = makeJsonRpc('GenericError');
export type JsonRpcGenericError = InstanceType<typeof JsonRpcGenericError>;

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
  GenericError: JsonRpcGenericError,
});

/**
 * Envelope for a JSON-RPC error not covered by any semantic code (e.g.
 * `METHOD_NOT_FOUND`, `PARSE_ERROR`, or a custom vendor code). Extends
 * {@link JsonRpcGenericError} so it still satisfies the transport
 * interface and `instanceof A2AError` checks.
 */
export class JsonRpcTransportError extends JsonRpcGenericError {
  public readonly errorResponse: JSONRPCErrorResponse;
  constructor(envelope: JSONRPCErrorResponse) {
    super({
      message: `JSON-RPC error: ${envelope.error.message} (Code: ${envelope.error.code}) Data: ${JSON.stringify(envelope.error.data || {})}`,
      envelopeCode: envelope.error.code,
      data: envelope.error.data,
    });
    // Override the parent's `this.name = 'GenericError'` so
    // `error.name === 'JsonRpcTransportError'` for catch-site consumers.
    this.name = 'JsonRpcTransportError';
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
    const spec = A2A_ERROR_SPECS[error.name];
    if (spec) {
      return {
        code: spec.code,
        message: error.message,
        data: [error.toErrorInfo()],
      };
    }
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
  const spec = A2A_ERROR_SPECS_BY_CODE[response.error.code];
  const semanticName = spec?.name ?? RESERVED_CODE_TO_SEMANTIC[response.error.code];
  if (semanticName) {
    return new JSON_RPC_ERROR_CLASSES[semanticName]({
      message: response.error.message,
      envelopeCode: response.error.code,
      data: response.error.data,
    });
  }
  return new JsonRpcTransportError(response);
}

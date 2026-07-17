/**
 * v0.3 compat error facade. Callers write `A2AError.taskNotFound(id)` or
 * `new A2AError(-32602, 'msg', data)` and receive a v1.0-aligned
 * {@link A2AError} instance so client and server share one hierarchy.
 * Wire codes without a semantic twin (`PARSE_ERROR`, `INVALID_REQUEST`,
 * `METHOD_NOT_FOUND`) are preserved via `JsonRpc*Error.envelopeCode`.
 */

import {
  A2A_ERROR_CODE,
  A2A_ERROR_CLASSES,
  A2A_ERROR_SPECS_BY_CODE,
  A2AError as BaseA2AError,
  ExtendedAgentCardNotConfiguredError,
  GenericError,
  JsonRpcRequestMalformedError,
  JsonRpcUnsupportedOperationError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from '../../../errors/index.js';

/**
 * Ergonomic wrapper: `new A2AError(code, message, data?)` returns the
 * matching semantic class (unknown codes fall back to a
 * `JsonRpc*Error` preserving the wire code). Also exposes the classic
 * v0.3 static factories (`.taskNotFound`, `.invalidParams`, …).
 *
 * The returned value is always an instance of {@link BaseA2AError};
 * `instanceof A2AError` also matches thanks to a `Symbol.hasInstance`
 * shim.
 */
interface A2AErrorFacade {
  new (code: number, message: string, data?: Record<string, unknown>): BaseA2AError;
  parseError(message: string, data?: Record<string, unknown>): BaseA2AError;
  invalidRequest(message: string, data?: Record<string, unknown>): BaseA2AError;
  methodNotFound(method: string): BaseA2AError;
  invalidParams(message: string, data?: Record<string, unknown>): BaseA2AError;
  internalError(message: string, data?: Record<string, unknown>): BaseA2AError;
  taskNotFound(taskId: string): BaseA2AError;
  taskNotCancelable(taskId: string): BaseA2AError;
  pushNotificationNotSupported(): BaseA2AError;
  unsupportedOperation(operation: string): BaseA2AError;
  authenticatedExtendedCardNotConfigured(): BaseA2AError;
  [Symbol.hasInstance](value: unknown): boolean;
}

function makeA2AError(code: number, message: string, data?: Record<string, unknown>): BaseA2AError {
  const spec = A2A_ERROR_SPECS_BY_CODE[code];
  if (spec) return new A2A_ERROR_CLASSES[spec.name]({ message });
  return new JsonRpcRequestMalformedError({
    message,
    envelopeCode: code,
    data: data as never,
  });
}

export const A2AError = makeA2AError as unknown as A2AErrorFacade;

/** Alias so callers writing `err: A2AError` keep type-checking. */
export type A2AError = BaseA2AError;

Object.defineProperty(A2AError, Symbol.hasInstance, {
  value: (v: unknown) => v instanceof BaseA2AError,
});

A2AError.parseError = (message, data) =>
  new JsonRpcRequestMalformedError({
    message,
    envelopeCode: A2A_ERROR_CODE.PARSE_ERROR,
    data: data as never,
  });

A2AError.invalidRequest = (message, data) =>
  new JsonRpcRequestMalformedError({
    message,
    envelopeCode: A2A_ERROR_CODE.INVALID_REQUEST,
    data: data as never,
  });

A2AError.methodNotFound = (method) =>
  new JsonRpcUnsupportedOperationError({
    message: `Method not found: ${method}`,
    envelopeCode: A2A_ERROR_CODE.METHOD_NOT_FOUND,
  });

A2AError.invalidParams = (message, data) =>
  data === undefined
    ? new RequestMalformedError({ message })
    : new JsonRpcRequestMalformedError({
        message,
        envelopeCode: A2A_ERROR_CODE.INVALID_PARAMS,
        data: data as never,
      });

A2AError.internalError = (message, data) =>
  data === undefined
    ? new GenericError({ message })
    : new JsonRpcRequestMalformedError({
        message,
        envelopeCode: A2A_ERROR_CODE.INTERNAL_ERROR,
        data: data as never,
      });

A2AError.taskNotFound = (taskId) => new TaskNotFoundError({ message: `Task not found: ${taskId}` });

A2AError.taskNotCancelable = (taskId) =>
  new TaskNotCancelableError({ message: `Task not cancelable: ${taskId}` });

A2AError.pushNotificationNotSupported = () => new PushNotificationNotSupportedError();

A2AError.unsupportedOperation = (operation) =>
  new UnsupportedOperationError({ message: `Unsupported operation: ${operation}` });

A2AError.authenticatedExtendedCardNotConfigured = () =>
  new ExtendedAgentCardNotConfiguredError({ message: 'Extended card not configured.' });

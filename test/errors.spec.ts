import { describe, it, expect, vi } from 'vitest';
import type { JSONRPCErrorResponse } from '../src/core.js';
import { A2A_ERROR_CLASSES, A2A_ERROR_SPECS } from '../src/errors/base.js';
import { JSON_RPC_CODE_TO_ERROR, JSON_RPC_ERROR_CODE } from '../src/errors/json_rpc.js';
import {
  A2A_ERROR_CODE,
  A2A_ERROR_DOMAIN,
  A2AError,
  ContentTypeNotSupportedError,
  ERROR_INFO_TYPE,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  extractErrorMessage,
  fromJsonRpcErrorResponse as mapJsonRpcErrorToSdkError,
  fromRestErrorBody,
  HTTP_STATUS,
  InvalidAgentResponseError,
  isJsonRpcError,
  isRestError,
  JsonRpcRequestMalformedError,
  JsonRpcTaskNotFoundError,
  JsonRpcTransportError as JSONRPCTransportError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  RestTaskNotFoundError,
  restStatusFor,
  TaskNotCancelableError,
  TaskNotFoundError,
  toJsonRpcError,
  toRestErrorBody,
  UnsupportedOperationError,
  VersionNotSupportedError,
} from '../src/errors/index.js';
import {
  GRPC_STATUS_CODE,
  GrpcTaskNotFoundError,
  grpcStatusFor,
  isGrpcError,
} from '../src/errors/grpc/index.js';

/** Thin wrapper that matches the removed `mapA2aErrorToSdkError` shape. */
function mapA2aErrorToSdkError(
  err: { code: number; message: string },
  fallback: () => Error
): Error {
  const name = JSON_RPC_CODE_TO_ERROR[err.code];
  if (name) return new A2A_ERROR_CLASSES[name]({ message: err.message });
  return fallback();
}

function makeEnvelope(code: number, message = 'boom'): JSONRPCErrorResponse {
  return {
    jsonrpc: '2.0',
    id: 1,
    error: { code, message },
  };
}

describe('mapJsonRpcErrorToSdkError', () => {
  // Codes that resolve to a spec-defined semantic class. The result's
  // message is preserved verbatim.
  it.each([
    [A2A_ERROR_CODE.PARSE_ERROR, RequestMalformedError],
    [A2A_ERROR_CODE.INVALID_REQUEST, RequestMalformedError],
    [A2A_ERROR_CODE.METHOD_NOT_FOUND, RequestMalformedError],
    [A2A_ERROR_CODE.INVALID_PARAMS, RequestMalformedError],
    [A2A_ERROR_CODE.TASK_NOT_FOUND, TaskNotFoundError],
    [A2A_ERROR_CODE.TASK_NOT_CANCELABLE, TaskNotCancelableError],
    [A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED, PushNotificationNotSupportedError],
    [A2A_ERROR_CODE.UNSUPPORTED_OPERATION, UnsupportedOperationError],
    [A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED, ContentTypeNotSupportedError],
    [A2A_ERROR_CODE.INVALID_AGENT_RESPONSE, InvalidAgentResponseError],
    [A2A_ERROR_CODE.EXTENDED_CARD_NOT_CONFIGURED, ExtendedAgentCardNotConfiguredError],
    [A2A_ERROR_CODE.EXTENSION_SUPPORT_REQUIRED, ExtensionSupportRequiredError],
    [A2A_ERROR_CODE.VERSION_NOT_SUPPORTED, VersionNotSupportedError],
  ])('maps JSON-RPC error code %i to the matching typed SDK error', (code, ExpectedErrorClass) => {
    const envelope = makeEnvelope(code, 'specific message');
    const result = mapJsonRpcErrorToSdkError(envelope);
    expect(result).toBeInstanceOf(ExpectedErrorClass);
    expect(result.message).toBe('specific message');
  });

  it('maps -32603 INTERNAL_ERROR to JsonRpcTransportError preserving the envelope code', () => {
    const envelope = makeEnvelope(A2A_ERROR_CODE.INTERNAL_ERROR, 'internal boom');
    const result = mapJsonRpcErrorToSdkError(envelope);
    expect(result).toBeInstanceOf(JSONRPCTransportError);
    expect((result as JSONRPCTransportError).envelopeCode).toBe(A2A_ERROR_CODE.INTERNAL_ERROR);
    expect(result.message).toBe('internal boom');
  });

  it('returns JSONRPCTransportError for unknown error codes', () => {
    const envelope = makeEnvelope(-99999, 'mysterious failure');
    const result = mapJsonRpcErrorToSdkError(envelope);
    expect(result).toBeInstanceOf(JSONRPCTransportError);
    const transportError = result as JSONRPCTransportError;
    expect(transportError.errorResponse).toBe(envelope);
    expect(transportError.message).toBe('mysterious failure');
    expect(transportError.envelopeCode).toBe(-99999);
  });

  it('JsonRpcTransportError sets a stable name for catch/instanceof callers', () => {
    const envelope = makeEnvelope(-99999);
    const result = mapJsonRpcErrorToSdkError(envelope);
    expect(result.name).toBe('JsonRpcTransportError');
  });

  it('preserves the original error message from the envelope', () => {
    const envelope = makeEnvelope(A2A_ERROR_CODE.TASK_NOT_FOUND, 'task xyz missing');
    const result = mapJsonRpcErrorToSdkError(envelope);
    expect(result).toBeInstanceOf(TaskNotFoundError);
    expect(result.message).toBe('task xyz missing');
  });
});

describe('mapA2aErrorToSdkError', () => {
  it('maps a known code to the matching typed SDK error', () => {
    const fallback = vi.fn(() => new Error('should not be called'));
    const result = mapA2aErrorToSdkError(
      { code: A2A_ERROR_CODE.TASK_NOT_FOUND, message: 'task xyz missing' },
      fallback
    );
    expect(result).toBeInstanceOf(TaskNotFoundError);
    expect(result.message).toBe('task xyz missing');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('propagates the message for the catch-all malformed-request bucket', () => {
    const fallback = vi.fn(() => new Error('should not be called'));
    const result = mapA2aErrorToSdkError(
      { code: A2A_ERROR_CODE.INVALID_PARAMS, message: 'bad params' },
      fallback
    );
    expect(result).toBeInstanceOf(RequestMalformedError);
    expect(result.message).toBe('bad params');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('invokes the fallback for unknown codes and returns its result', () => {
    const fallbackError = new Error('fallback chosen');
    const fallback = vi.fn(() => fallbackError);
    const result = mapA2aErrorToSdkError({ code: -99999, message: 'mystery' }, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result).toBe(fallbackError);
  });
});

describe('extractErrorMessage', () => {
  it("returns an Error's message verbatim", () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns subclass error messages', () => {
    expect(extractErrorMessage(new TaskNotFoundError('task-42'))).toContain('task-42');
  });

  it('returns strings as-is', () => {
    expect(extractErrorMessage('plain string')).toBe('plain string');
  });

  it('stringifies null and undefined', () => {
    expect(extractErrorMessage(null)).toBe('null');
    expect(extractErrorMessage(undefined)).toBe('undefined');
  });

  it('JSON-stringifies plain objects', () => {
    expect(extractErrorMessage({ code: 'E_FOO', detail: 'bar' })).toBe(
      '{"code":"E_FOO","detail":"bar"}'
    );
  });

  it('JSON-stringifies arrays and numbers', () => {
    expect(extractErrorMessage([1, 2, 3])).toBe('[1,2,3]');
    expect(extractErrorMessage(42)).toBe('42');
  });

  it('falls back to String(err) when JSON.stringify throws (e.g. BigInt)', () => {
    // `JSON.stringify` throws TypeError on BigInt values; the helper
    // must not propagate that, otherwise the catch handlers that use it
    // would themselves re-throw and mask the original failure.
    expect(extractErrorMessage(10n)).toBe('10');
  });

  it('falls back to String(err) for cyclic objects', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    // `JSON.stringify` on a cycle throws TypeError → fallback to
    // `String(cyclic)` which yields `"[object Object]"`.
    expect(extractErrorMessage(cyclic)).toBe('[object Object]');
  });
});

// ---------------------------------------------------------------------------
// Hierarchy: every transport variant is-a semantic subclass is-a A2AError.
// Guards `isRestError` / `isGrpcError` / `isJsonRpcError` narrow correctly,
// and only ONE guard matches per instance (transports are exclusive).
// ---------------------------------------------------------------------------

describe('A2AError hierarchy', () => {
  it('semantic class extends A2AError extends Error', () => {
    const e = new TaskNotFoundError({ message: 't-1' });
    expect(e).toBeInstanceOf(TaskNotFoundError);
    expect(e).toBeInstanceOf(A2AError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('TaskNotFoundError');
    expect(JSON_RPC_ERROR_CODE[e.name]).toBe(-32001);
    expect(e.reason).toBe('TASK_NOT_FOUND');
  });

  it('RestTaskNotFoundError is-a TaskNotFoundError is-a A2AError', () => {
    const e = new RestTaskNotFoundError({ statusCode: 404 });
    expect(e).toBeInstanceOf(RestTaskNotFoundError);
    expect(e).toBeInstanceOf(TaskNotFoundError);
    expect(e).toBeInstanceOf(A2AError);
    expect(e).toBeInstanceOf(Error);
  });

  it('GrpcTaskNotFoundError is-a TaskNotFoundError is-a A2AError', () => {
    const e = new GrpcTaskNotFoundError({ status: GRPC_STATUS_CODE.NOT_FOUND });
    expect(e).toBeInstanceOf(GrpcTaskNotFoundError);
    expect(e).toBeInstanceOf(TaskNotFoundError);
    expect(e).toBeInstanceOf(A2AError);
  });

  it('JsonRpcTaskNotFoundError is-a TaskNotFoundError is-a A2AError', () => {
    const e = new JsonRpcTaskNotFoundError({ envelopeCode: -32001 });
    expect(e).toBeInstanceOf(JsonRpcTaskNotFoundError);
    expect(e).toBeInstanceOf(TaskNotFoundError);
    expect(e).toBeInstanceOf(A2AError);
  });

  it('semantic class name is preserved across transport variants', () => {
    // Users rely on `error.name === 'TaskNotFoundError'` for logging /
    // instanceof-adjacent branching; the makeRest/makeGrpc/makeJsonRpc
    // factories override `this.name = <semantic>` for this reason.
    expect(new RestTaskNotFoundError().name).toBe('TaskNotFoundError');
    expect(new GrpcTaskNotFoundError().name).toBe('TaskNotFoundError');
    expect(new JsonRpcTaskNotFoundError().name).toBe('TaskNotFoundError');
  });
});

describe('transport type guards', () => {
  it('isRestError narrows only RestA2AError instances', () => {
    expect(isRestError(new RestTaskNotFoundError({ statusCode: 404 }))).toBe(true);
    expect(isRestError(new GrpcTaskNotFoundError())).toBe(false);
    expect(isRestError(new JsonRpcTaskNotFoundError())).toBe(false);
    expect(isRestError(new TaskNotFoundError())).toBe(false); // plain semantic
    expect(isRestError(new Error('nope'))).toBe(false);
    expect(isRestError(null)).toBe(false);
    expect(isRestError(undefined)).toBe(false);
    expect(isRestError('string')).toBe(false);
  });

  it('isGrpcError narrows only GrpcA2AError instances', () => {
    expect(isGrpcError(new GrpcTaskNotFoundError({ status: GRPC_STATUS_CODE.NOT_FOUND }))).toBe(
      true
    );
    expect(isGrpcError(new RestTaskNotFoundError())).toBe(false);
    expect(isGrpcError(new JsonRpcTaskNotFoundError())).toBe(false);
    expect(isGrpcError(new TaskNotFoundError())).toBe(false);
    expect(isGrpcError(new Error('nope'))).toBe(false);
  });

  it('isJsonRpcError narrows only JsonRpcA2AError instances', () => {
    expect(isJsonRpcError(new JsonRpcTaskNotFoundError({ envelopeCode: -32001 }))).toBe(true);
    expect(isJsonRpcError(new RestTaskNotFoundError())).toBe(false);
    expect(isJsonRpcError(new GrpcTaskNotFoundError())).toBe(false);
    expect(isJsonRpcError(new TaskNotFoundError())).toBe(false);
    expect(isJsonRpcError(new Error('nope'))).toBe(false);
  });

  it('transports are mutually exclusive: exactly one guard matches per instance', () => {
    const rest = new RestTaskNotFoundError({ statusCode: 404 });
    const grpc = new GrpcTaskNotFoundError({ status: GRPC_STATUS_CODE.NOT_FOUND });
    const json = new JsonRpcTaskNotFoundError({ envelopeCode: -32001 });

    expect([isRestError(rest), isGrpcError(rest), isJsonRpcError(rest)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([isRestError(grpc), isGrpcError(grpc), isJsonRpcError(grpc)]).toEqual([
      false,
      true,
      false,
    ]);
    expect([isRestError(json), isGrpcError(json), isJsonRpcError(json)]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('guards enable typed access to transport context', () => {
    // Compile-time proof (delete the guard and TS complains) + runtime.
    const err: A2AError = new RestTaskNotFoundError({
      statusCode: 429,
      headers: { 'retry-after': '10' },
    });
    if (isRestError(err)) {
      expect(err.statusCode).toBe(429);
      expect(err.headers?.['retry-after']).toBe('10');
    }
  });
});

// ---------------------------------------------------------------------------
// Options plumbing: message defaults, message override, metadata, cause.
// ---------------------------------------------------------------------------

describe('A2AError construction', () => {
  it('defaults message from spec.defaultMessage when none is passed', () => {
    expect(new TaskNotFoundError().message).toBe('Task not found');
    expect(new UnsupportedOperationError().message).toBe('This operation is not supported');
    // Concrete A2AError (no spec entry) falls back to a generic message.
    expect(new A2AError().message).toBe('An unexpected error occurred.');
  });

  it('accepts a bare string as the message (legacy call shape)', () => {
    expect(new TaskNotFoundError('custom text').message).toBe('custom text');
  });

  it('accepts an options object with message', () => {
    expect(new TaskNotFoundError({ message: 'via options' }).message).toBe('via options');
  });

  it('preserves cause (ES2022 Error.cause)', () => {
    const root = new Error('root');
    const e = new TaskNotFoundError({ message: 'wrapped', cause: root });
    expect((e as unknown as { cause: unknown }).cause).toBe(root);
  });

  it('stores metadata when non-empty and omits it when empty', () => {
    const withMd = new TaskNotFoundError({ metadata: { taskId: 't-1' } });
    expect(withMd.metadata).toEqual({ taskId: 't-1' });

    const withoutMd = new TaskNotFoundError({ metadata: {} });
    expect(withoutMd.metadata).toBeUndefined();

    const noArg = new TaskNotFoundError();
    expect(noArg.metadata).toBeUndefined();
  });

  it('every semantic error has a corresponding entry in A2A_ERROR_SPECS', () => {
    for (const [name, Cls] of Object.entries(A2A_ERROR_CLASSES)) {
      const instance = new Cls();
      const spec = A2A_ERROR_SPECS[name];
      expect(spec).toBeDefined();
      expect(instance.reason).toBe(spec.reason);
      // Per-transport code lives in the transport-specific tables.
      expect(JSON_RPC_ERROR_CODE[name]).toBeTypeOf('number');
    }
  });
});

// ---------------------------------------------------------------------------
// toErrorInfo(): the shape shipped in google.rpc.ErrorInfo (spec §10.6/§11.6).
// ---------------------------------------------------------------------------

describe('A2AError.toErrorInfo', () => {
  it('returns spec-shaped ErrorInfo with the right @type and domain', () => {
    const info = new TaskNotFoundError().toErrorInfo();
    expect(info['@type']).toBe(ERROR_INFO_TYPE);
    expect(info.reason).toBe('TASK_NOT_FOUND');
    expect(info.domain).toBe(A2A_ERROR_DOMAIN);
    expect(info).not.toHaveProperty('metadata'); // omitted when empty
  });

  it('emits metadata when the constructor received a non-empty map', () => {
    const info = new TaskNotFoundError({ metadata: { taskId: 't-1' } }).toErrorInfo();
    expect(info.metadata).toEqual({ taskId: 't-1' });
  });
});

// ---------------------------------------------------------------------------
// Status helpers: restStatusFor / grpcStatusFor honor the instance override
// but fall back to the semantic spec, and default to UNKNOWN/500 otherwise.
// ---------------------------------------------------------------------------

describe('restStatusFor', () => {
  it('returns the instance-level statusCode when it is a RestA2AError', () => {
    expect(restStatusFor(new RestTaskNotFoundError({ statusCode: 418 }))).toBe(418);
  });

  it('falls back to the spec httpStatus for a plain semantic error', () => {
    expect(restStatusFor(new TaskNotFoundError())).toBe(HTTP_STATUS.NOT_FOUND);
    expect(restStatusFor(new UnsupportedOperationError())).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(restStatusFor(new InvalidAgentResponseError())).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
  });

  it('returns 500 for non-A2A throwables', () => {
    expect(restStatusFor(new Error('unrelated'))).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(restStatusFor('string')).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(restStatusFor(undefined)).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
  });
});

describe('grpcStatusFor', () => {
  it('returns the instance-level status when it is a GrpcA2AError', () => {
    expect(grpcStatusFor(new GrpcTaskNotFoundError({ status: GRPC_STATUS_CODE.CANCELLED }))).toBe(
      GRPC_STATUS_CODE.CANCELLED
    );
  });

  it('falls back to the spec grpcStatus for a plain semantic error', () => {
    expect(grpcStatusFor(new TaskNotFoundError())).toBe(GRPC_STATUS_CODE.NOT_FOUND);
    expect(grpcStatusFor(new ContentTypeNotSupportedError())).toBe(
      GRPC_STATUS_CODE.INVALID_ARGUMENT
    );
    expect(grpcStatusFor(new InvalidAgentResponseError())).toBe(GRPC_STATUS_CODE.INTERNAL);
  });

  it('returns UNKNOWN for non-A2A throwables', () => {
    expect(grpcStatusFor(new Error('unrelated'))).toBe(GRPC_STATUS_CODE.UNKNOWN);
    expect(grpcStatusFor(null)).toBe(GRPC_STATUS_CODE.UNKNOWN);
  });
});

// ---------------------------------------------------------------------------
// Wire roundtrips: serialize semantic error -> parse -> same class + metadata.
// ---------------------------------------------------------------------------

describe('REST roundtrip', () => {
  it('semantic error survives toRestErrorBody -> fromRestErrorBody', () => {
    const original = new TaskNotFoundError({
      message: 'task xyz missing',
      metadata: { taskId: 'xyz' },
    });
    const body = toRestErrorBody(original, HTTP_STATUS.NOT_FOUND);

    // §11.6 body shape.
    expect(body.error.code).toBe(HTTP_STATUS.NOT_FOUND);
    expect(body.error.status).toBe('NOT_FOUND');
    expect(body.error.message).toBe('task xyz missing');
    expect(body.error.details[0]).toMatchObject({
      '@type': ERROR_INFO_TYPE,
      reason: 'TASK_NOT_FOUND',
      domain: A2A_ERROR_DOMAIN,
      metadata: { taskId: 'xyz' },
    });

    const rebuilt = fromRestErrorBody(body.error, {
      statusCode: HTTP_STATUS.NOT_FOUND,
      headers: { 'x-a': '1' },
    });

    expect(rebuilt).toBeInstanceOf(TaskNotFoundError);
    expect(rebuilt).toBeInstanceOf(RestTaskNotFoundError);
    expect(rebuilt.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    expect(rebuilt.headers?.['x-a']).toBe('1');
    expect(rebuilt.metadata).toEqual({ taskId: 'xyz' });
    expect(rebuilt.message).toBe('task xyz missing');
  });

  it('body without ErrorInfo detail becomes a REST-scoped A2AError fallback', () => {
    const rebuilt = fromRestErrorBody({ message: 'plain 500', details: [] }, { statusCode: 500 });
    expect(rebuilt).toBeInstanceOf(A2AError);
    expect(rebuilt).not.toBeInstanceOf(TaskNotFoundError);
    expect(isRestError(rebuilt)).toBe(true);
    expect(rebuilt.name).toBe('A2AError');
    expect(rebuilt.message).toBe('plain 500');
    expect(rebuilt.statusCode).toBe(500);
  });

  it('body with unknown ErrorInfo.reason falls through to the A2AError fallback', () => {
    const rebuilt = fromRestErrorBody(
      {
        message: 'unknown',
        details: [{ '@type': ERROR_INFO_TYPE, reason: 'MADE_UP_REASON', domain: 'nope' }],
      },
      { statusCode: 500 }
    );
    expect(rebuilt.name).toBe('A2AError');
  });

  it('ignores metadata when the ErrorInfo.domain is not a2a-protocol.org', () => {
    const rebuilt = fromRestErrorBody(
      {
        message: 'foreign',
        details: [
          {
            '@type': ERROR_INFO_TYPE,
            reason: 'TASK_NOT_FOUND',
            domain: 'other.example',
            metadata: { taskId: 't-1' },
          },
        ],
      },
      { statusCode: 404 }
    );
    expect(rebuilt).toBeInstanceOf(TaskNotFoundError);
    expect(rebuilt.metadata).toBeUndefined();
  });
});

describe('JSON-RPC roundtrip', () => {
  it('semantic error survives toJsonRpcError -> fromJsonRpcErrorResponse', () => {
    const original = new TaskNotFoundError({
      message: 'task xyz missing',
      metadata: { taskId: 'xyz' },
    });
    const envelopeError = toJsonRpcError(original);

    expect(envelopeError.code).toBe(A2A_ERROR_CODE.TASK_NOT_FOUND);
    expect(envelopeError.message).toBe('task xyz missing');
    expect(envelopeError.data?.[0]).toMatchObject({
      '@type': ERROR_INFO_TYPE,
      reason: 'TASK_NOT_FOUND',
      domain: A2A_ERROR_DOMAIN,
      metadata: { taskId: 'xyz' },
    });

    const rebuilt = mapJsonRpcErrorToSdkError({
      jsonrpc: '2.0',
      id: 1,
      error: envelopeError,
    });
    expect(rebuilt).toBeInstanceOf(TaskNotFoundError);
    expect(rebuilt).toBeInstanceOf(JsonRpcTaskNotFoundError);
    expect(rebuilt.envelopeCode).toBe(A2A_ERROR_CODE.TASK_NOT_FOUND);
    expect(rebuilt.message).toBe('task xyz missing');
  });

  it('JsonRpc*Error.envelopeCode overrides the semantic default', () => {
    // v0.3 compat case: METHOD_NOT_FOUND has no semantic twin, so we
    // route it through JsonRpcRequestMalformedError with envelopeCode
    // overridden. The envelope must preserve that wire code.
    const err = new JsonRpcRequestMalformedError({
      message: 'no such method',
      envelopeCode: A2A_ERROR_CODE.METHOD_NOT_FOUND,
    });
    const envelope = toJsonRpcError(err);
    expect(envelope.code).toBe(A2A_ERROR_CODE.METHOD_NOT_FOUND); // NOT -32602
    expect(envelope.message).toBe('no such method');
  });

  it('unknown code becomes JsonRpcTransportError carrying the full envelope', () => {
    const envelope: JSONRPCErrorResponse = {
      jsonrpc: '2.0',
      id: 9,
      error: { code: -99999, message: 'mystery', data: { foo: 'bar' } },
    };
    const rebuilt = mapJsonRpcErrorToSdkError(envelope);
    expect(rebuilt).toBeInstanceOf(JSONRPCTransportError);
    expect((rebuilt as JSONRPCTransportError).errorResponse).toBe(envelope);
    expect(isJsonRpcError(rebuilt)).toBe(true);
  });
});

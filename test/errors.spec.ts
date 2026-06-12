import { describe, it, expect, vi } from 'vitest';
import type { JSONRPCErrorResponse } from '../src/core.js';
import {
  A2A_ERROR_CODE,
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  InvalidAgentResponseError,
  JSONRPCTransportError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
  mapA2aErrorToSdkError,
  mapJsonRpcErrorToSdkError,
  extractErrorMessage,
} from '../src/errors.js';

function makeEnvelope(code: number, message = 'boom'): JSONRPCErrorResponse {
  return {
    jsonrpc: '2.0',
    id: 1,
    error: { code, message },
  };
}

describe('mapJsonRpcErrorToSdkError', () => {
  it.each([
    [A2A_ERROR_CODE.PARSE_ERROR, RequestMalformedError],
    [A2A_ERROR_CODE.INVALID_REQUEST, RequestMalformedError],
    [A2A_ERROR_CODE.METHOD_NOT_FOUND, RequestMalformedError],
    [A2A_ERROR_CODE.INVALID_PARAMS, RequestMalformedError],
    [A2A_ERROR_CODE.INTERNAL_ERROR, RequestMalformedError],
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

  it('returns JSONRPCTransportError for unknown error codes', () => {
    const envelope = makeEnvelope(-99999, 'mysterious failure');
    const result = mapJsonRpcErrorToSdkError(envelope);
    expect(result).toBeInstanceOf(JSONRPCTransportError);
    const transportError = result as JSONRPCTransportError;
    expect(transportError.errorResponse).toBe(envelope);
    expect(transportError.message).toContain('mysterious failure');
    expect(transportError.message).toContain('-99999');
  });

  it('JSONRPCTransportError sets a stable name for catch/instanceof callers', () => {
    const envelope = makeEnvelope(-99999);
    const result = mapJsonRpcErrorToSdkError(envelope);
    expect(result.name).toBe('JSONRPCTransportError');
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

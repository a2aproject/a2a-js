import { describe, it, expect } from 'vitest';
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
  mapJsonRpcErrorToSdkError,
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

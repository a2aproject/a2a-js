import { describe, it, expect, vi } from 'vitest';
import type { JSONRPCErrorResponse } from '../src/core.js';
import {
  A2A_ERROR_CODE,
  A2A_ERROR_GRPC_STATUS_CODE,
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  GenericError,
  GRPC_STATUS_CODE,
  InvalidAgentResponseError,
  JSONRPCTransportError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
  errorClassNameToGrpcStatusCode,
  grpcStatusCodeToErrorClass,
  mapA2aErrorToSdkError,
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

describe('errorClassNameToGrpcStatusCode', () => {
  it.each([
    ['TaskNotFoundError', GRPC_STATUS_CODE.NOT_FOUND],
    ['TaskNotCancelableError', GRPC_STATUS_CODE.FAILED_PRECONDITION],
    ['PushNotificationNotSupportedError', GRPC_STATUS_CODE.FAILED_PRECONDITION],
    ['UnsupportedOperationError', GRPC_STATUS_CODE.FAILED_PRECONDITION],
    ['ContentTypeNotSupportedError', GRPC_STATUS_CODE.INVALID_ARGUMENT],
    ['InvalidAgentResponseError', GRPC_STATUS_CODE.INTERNAL],
    ['ExtendedAgentCardNotConfiguredError', GRPC_STATUS_CODE.FAILED_PRECONDITION],
    ['ExtensionSupportRequiredError', GRPC_STATUS_CODE.FAILED_PRECONDITION],
    ['VersionNotSupportedError', GRPC_STATUS_CODE.FAILED_PRECONDITION],
    ['RequestMalformedError', GRPC_STATUS_CODE.INVALID_ARGUMENT],
    ['GenericError', GRPC_STATUS_CODE.INTERNAL],
  ])('maps %s to the canonical gRPC status code (%i)', (name, expected) => {
    expect(errorClassNameToGrpcStatusCode(name)).toBe(expected);
    // Sanity-check: the same value is reachable via the public table.
    expect(A2A_ERROR_GRPC_STATUS_CODE[name]).toBe(expected);
  });

  it('falls back to UNKNOWN for unrecognized error class names', () => {
    expect(errorClassNameToGrpcStatusCode('SomeUnknownError')).toBe(GRPC_STATUS_CODE.UNKNOWN);
  });

  it('agrees with `new ErrorClass().name` for every known A2A error class', () => {
    const classes: Array<new (msg?: string) => Error> = [
      TaskNotFoundError,
      TaskNotCancelableError,
      PushNotificationNotSupportedError,
      UnsupportedOperationError,
      ContentTypeNotSupportedError,
      InvalidAgentResponseError,
      ExtendedAgentCardNotConfiguredError,
      ExtensionSupportRequiredError,
      VersionNotSupportedError,
      RequestMalformedError,
      GenericError,
    ];
    for (const Cls of classes) {
      const code = errorClassNameToGrpcStatusCode(new Cls().name);
      expect(code).not.toBe(GRPC_STATUS_CODE.UNKNOWN);
    }
  });
});

describe('grpcStatusCodeToErrorClass', () => {
  it('maps NOT_FOUND to TaskNotFoundError regardless of method', () => {
    expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.NOT_FOUND)).toBe(TaskNotFoundError);
    expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.NOT_FOUND, 'getTask')).toBe(
      TaskNotFoundError
    );
  });

  it('maps FAILED_PRECONDITION on cancelTask to TaskNotCancelableError', () => {
    expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.FAILED_PRECONDITION, 'cancelTask')).toBe(
      TaskNotCancelableError
    );
  });

  it('maps FAILED_PRECONDITION on getAgentCard/getExtendedAgentCard to ExtendedAgentCardNotConfiguredError', () => {
    expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.FAILED_PRECONDITION, 'getAgentCard')).toBe(
      ExtendedAgentCardNotConfiguredError
    );
    expect(
      grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.FAILED_PRECONDITION, 'getExtendedAgentCard')
    ).toBe(ExtendedAgentCardNotConfiguredError);
  });

  it('returns undefined for FAILED_PRECONDITION on unrelated methods', () => {
    expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.FAILED_PRECONDITION, 'getTask')).toBe(
      undefined
    );
    expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.FAILED_PRECONDITION)).toBe(undefined);
  });

  it('maps UNIMPLEMENTED on push notification methods to PushNotificationNotSupportedError', () => {
    for (const method of [
      'getTaskPushNotificationConfig',
      'createTaskPushNotificationConfig',
      'deleteTaskPushNotificationConfig',
      'listTaskPushNotificationConfig',
      'listTaskPushNotificationConfigs',
    ]) {
      expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.UNIMPLEMENTED, method)).toBe(
        PushNotificationNotSupportedError
      );
    }
  });

  it('maps UNIMPLEMENTED on agent-card/subscribe methods to UnsupportedOperationError', () => {
    for (const method of [
      'getAgentCard',
      'getExtendedAgentCard',
      'taskSubscription',
      'subscribeToTask',
    ]) {
      expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.UNIMPLEMENTED, method)).toBe(
        UnsupportedOperationError
      );
    }
  });

  it('returns undefined for UNIMPLEMENTED on unrelated methods', () => {
    expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.UNIMPLEMENTED, 'sendMessage')).toBe(
      undefined
    );
  });

  it('returns undefined for status codes with no SDK error mapping', () => {
    expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.UNKNOWN)).toBe(undefined);
    expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.INVALID_ARGUMENT, 'sendMessage')).toBe(
      undefined
    );
    expect(grpcStatusCodeToErrorClass(GRPC_STATUS_CODE.INTERNAL)).toBe(undefined);
  });
});

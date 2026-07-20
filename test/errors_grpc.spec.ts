/**
 * gRPC-transport roundtrip tests for the shared error hierarchy.
 *
 * Split out from `errors.spec.ts` because `@grpc/grpc-js` is Node-only
 * (the Workers-safe edge suite excludes anything that imports it).
 */

import { Metadata, status as grpcStatus, type ServiceError } from '@grpc/grpc-js';
import { describe, it, expect } from 'vitest';
import {
  buildGrpcErrorMetadata,
  fromGrpcError,
  GenericError,
  GrpcTaskNotFoundError,
  isGrpcError,
  TaskNotFoundError,
} from '../src/errors/index.js';

describe('gRPC roundtrip', () => {
  it('semantic error survives buildGrpcErrorMetadata -> fromGrpcError', () => {
    const original = new TaskNotFoundError({
      message: 'task xyz missing',
      metadata: { taskId: 'xyz' },
    });
    const md = buildGrpcErrorMetadata(Metadata, original);
    expect(md).toBeDefined();

    const wireError = {
      code: grpcStatus.NOT_FOUND,
      details: 'task xyz missing',
      metadata: md,
      message: 'ignored',
      name: 'ServiceError',
    } as ServiceError;

    const rebuilt = fromGrpcError(wireError);
    expect(rebuilt).toBeInstanceOf(TaskNotFoundError);
    expect(rebuilt).toBeInstanceOf(GrpcTaskNotFoundError);
    expect(rebuilt.status).toBe(grpcStatus.NOT_FOUND);
    expect(rebuilt.metadata).toEqual({ taskId: 'xyz' });
    expect(rebuilt.message).toBe('task xyz missing');
    expect(rebuilt.statusDetailsBin).toBeInstanceOf(Buffer);
  });

  it('returns undefined metadata when the input error has no A2A spec entry', () => {
    expect(buildGrpcErrorMetadata(Metadata, new Error('unrelated'))).toBeUndefined();
    expect(buildGrpcErrorMetadata(Metadata, 'string')).toBeUndefined();
  });

  it('service error without grpc-status-details-bin becomes GrpcGenericError', () => {
    const wireError = {
      code: grpcStatus.INTERNAL,
      details: 'boom',
      metadata: new Metadata(),
      message: 'ignored',
      name: 'ServiceError',
    } as ServiceError;
    const rebuilt = fromGrpcError(wireError, 'SendMessage');
    expect(rebuilt).toBeInstanceOf(GenericError);
    expect(isGrpcError(rebuilt)).toBe(true);
    expect(rebuilt.status).toBe(grpcStatus.INTERNAL);
    // method suffix appears in the fallback message for debuggability.
    expect(rebuilt.message).toContain('SendMessage');
  });
});

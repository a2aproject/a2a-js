/**
 * Utilities for encoding and decoding `google.rpc.Status` with
 * `google.rpc.ErrorInfo` in gRPC error metadata.
 */

import * as grpc from '@grpc/grpc-js';
import { A2A_ERROR_DOMAIN, A2A_ERROR_REASON, ERROR_INFO_TYPE } from '../../errors.js';
import { Status } from '../../grpc/pb/google/rpc/status.js';
import { ErrorInfo } from '../../grpc/pb/google/rpc/error_details.js';
import { Any } from '../../grpc/pb/google/protobuf/any.js';

/**
 * Builds gRPC trailing metadata with `grpc-status-details-bin` carrying
 * a `google.rpc.Status` + `google.rpc.ErrorInfo`. Returns `undefined`
 * if `error` has no known reason mapping.
 */
export function buildGrpcErrorMetadata(
  grpcCode: number,
  message: string,
  error: Error
): grpc.Metadata | undefined {
  const reason = A2A_ERROR_REASON[error.name];
  if (!reason) return undefined;

  const errorInfoBytes = Buffer.from(
    ErrorInfo.encode({
      reason,
      domain: A2A_ERROR_DOMAIN,
      metadata: {},
    }).finish()
  );

  const statusBytes = Buffer.from(
    Status.encode({
      code: grpcCode,
      message,
      details: [
        {
          typeUrl: ERROR_INFO_TYPE,
          value: errorInfoBytes,
        },
      ],
    }).finish()
  );

  const metadata = new grpc.Metadata();
  metadata.set('grpc-status-details-bin', statusBytes);
  return metadata;
}

/** Decodes a `google.rpc.Status` protobuf message from binary. */
export function decodeStatus(buffer: Buffer): {
  code: number;
  message: string;
  details: Any[];
} {
  return Status.decode(new Uint8Array(buffer));
}

/** Decodes a `google.rpc.ErrorInfo` protobuf message from binary. */
export function decodeErrorInfo(buffer: Buffer): {
  reason: string;
  domain: string;
  metadata: Record<string, string>;
} {
  return ErrorInfo.decode(new Uint8Array(buffer));
}

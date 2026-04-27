/**
 * Utilities for encoding and decoding google.rpc.Status with
 * google.rpc.ErrorInfo in gRPC error metadata per §10.6.
 *
 * Uses the generated protobuf types from google/rpc/status.proto and
 * google/rpc/error_details.proto for encoding/decoding.
 */

import * as grpc from '@grpc/grpc-js';
import { A2A_ERROR_DOMAIN, A2A_ERROR_REASON, ERROR_INFO_TYPE } from '../../errors.js';
import { Status } from '../../grpc/pb/google/rpc/status.js';
import { ErrorInfo } from '../../grpc/pb/google/rpc/error_details.js';
import { Any } from '../../grpc/pb/google/protobuf/any.js';

/**
 * Builds gRPC trailing metadata containing `grpc-status-details-bin`
 * with an encoded `google.rpc.Status` carrying a `google.rpc.ErrorInfo` detail.
 *
 * @param grpcCode - The gRPC status code
 * @param message - The error message
 * @param error - The SDK error instance (used to look up the reason code)
 * @returns gRPC Metadata with the encoded status details, or undefined if no reason mapping exists
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

/**
 * Decodes a `google.rpc.Status` protobuf message from binary.
 * Used by the client to parse `grpc-status-details-bin` metadata.
 */
export function decodeStatus(buffer: Buffer): {
  code: number;
  message: string;
  details: Any[];
} {
  return Status.decode(new Uint8Array(buffer));
}

/**
 * Decodes a `google.rpc.ErrorInfo` protobuf message from binary.
 * Used by the client to extract reason and domain from error details.
 */
export function decodeErrorInfo(buffer: Buffer): {
  reason: string;
  domain: string;
  metadata: Record<string, string>;
} {
  return ErrorInfo.decode(new Uint8Array(buffer));
}

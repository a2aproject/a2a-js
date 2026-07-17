/**
 * gRPC transport error subclasses and wire helpers. Absorbs the
 * previous `src/server/grpc/error_details.ts`.
 *
 * gRPC does NOT carry a `cause` on the wire, so the transport context
 * exposes status code + the `grpc-status-details-bin` trailing
 * metadata blob only.
 */

import type * as grpc from '@grpc/grpc-js';
import {
  A2A_ERROR_CLASSES,
  A2A_ERROR_DOMAIN,
  A2A_ERROR_SPECS,
  A2A_ERROR_SPECS_BY_REASON,
  A2AError,
  type A2AErrorOptions,
  ERROR_INFO_TYPE,
  GRPC_STATUS,
} from './base.js';
import { Any } from '../grpc/pb/google/protobuf/any.js';
import { ErrorInfo } from '../grpc/pb/google/rpc/error_details.js';
import { Status } from '../grpc/pb/google/rpc/status.js';

/** Trailing metadata key for `google.rpc.Status`. */
export const GRPC_STATUS_DETAILS_BIN = 'grpc-status-details-bin';

/** Transport context carried by every `Grpc*Error`. */
export interface GrpcA2AError extends A2AError {
  readonly transport: 'grpc';
  readonly status: number;
  /** Raw `grpc-status-details-bin` blob for callers that want to re-encode. */
  readonly statusDetailsBin?: Buffer;
}

/** Options accepted by every `Grpc*Error` constructor. */
export interface GrpcA2AErrorOptions extends A2AErrorOptions {
  /** gRPC status code. Defaults to the semantic error's spec value. */
  status?: number;
  /** Raw `grpc-status-details-bin` blob if received on the wire. */
  statusDetailsBin?: Buffer;
}

/** Type guard narrowing an unknown / `A2AError` to {@link GrpcA2AError}. */
export function isGrpcError(err: unknown): err is GrpcA2AError {
  return err instanceof A2AError && (err as { transport?: string }).transport === 'grpc';
}

function makeGrpc(name: string): new (options?: GrpcA2AErrorOptions) => GrpcA2AError {
  const spec = A2A_ERROR_SPECS[name];
  const Base = A2A_ERROR_CLASSES[name];
  const cls = {
    [`Grpc${name}`]: class extends Base {
      public readonly transport = 'grpc';
      public readonly status: number;
      public readonly statusDetailsBin?: Buffer;
      constructor(options?: GrpcA2AErrorOptions) {
        super(options);
        this.name = name;
        this.status = options?.status ?? spec.grpcStatus;
        if (options?.statusDetailsBin) this.statusDetailsBin = options.statusDetailsBin;
      }
    },
  }[`Grpc${name}`];
  return cls as unknown as new (options?: GrpcA2AErrorOptions) => GrpcA2AError;
}

export const GrpcTaskNotFoundError = makeGrpc('TaskNotFoundError');
export type GrpcTaskNotFoundError = InstanceType<typeof GrpcTaskNotFoundError>;

export const GrpcTaskNotCancelableError = makeGrpc('TaskNotCancelableError');
export type GrpcTaskNotCancelableError = InstanceType<typeof GrpcTaskNotCancelableError>;

export const GrpcPushNotificationNotSupportedError = makeGrpc('PushNotificationNotSupportedError');
export type GrpcPushNotificationNotSupportedError = InstanceType<
  typeof GrpcPushNotificationNotSupportedError
>;

export const GrpcUnsupportedOperationError = makeGrpc('UnsupportedOperationError');
export type GrpcUnsupportedOperationError = InstanceType<typeof GrpcUnsupportedOperationError>;

export const GrpcContentTypeNotSupportedError = makeGrpc('ContentTypeNotSupportedError');
export type GrpcContentTypeNotSupportedError = InstanceType<
  typeof GrpcContentTypeNotSupportedError
>;

export const GrpcInvalidAgentResponseError = makeGrpc('InvalidAgentResponseError');
export type GrpcInvalidAgentResponseError = InstanceType<typeof GrpcInvalidAgentResponseError>;

export const GrpcExtendedAgentCardNotConfiguredError = makeGrpc(
  'ExtendedAgentCardNotConfiguredError'
);
export type GrpcExtendedAgentCardNotConfiguredError = InstanceType<
  typeof GrpcExtendedAgentCardNotConfiguredError
>;

export const GrpcExtensionSupportRequiredError = makeGrpc('ExtensionSupportRequiredError');
export type GrpcExtensionSupportRequiredError = InstanceType<
  typeof GrpcExtensionSupportRequiredError
>;

export const GrpcVersionNotSupportedError = makeGrpc('VersionNotSupportedError');
export type GrpcVersionNotSupportedError = InstanceType<typeof GrpcVersionNotSupportedError>;

export const GrpcRequestMalformedError = makeGrpc('RequestMalformedError');
export type GrpcRequestMalformedError = InstanceType<typeof GrpcRequestMalformedError>;

export const GrpcGenericError = makeGrpc('GenericError');
export type GrpcGenericError = InstanceType<typeof GrpcGenericError>;

/** gRPC twins indexed by their semantic parent's name. */
export const GRPC_ERROR_CLASSES: Readonly<
  Record<string, new (options?: GrpcA2AErrorOptions) => GrpcA2AError>
> = Object.freeze({
  TaskNotFoundError: GrpcTaskNotFoundError,
  TaskNotCancelableError: GrpcTaskNotCancelableError,
  PushNotificationNotSupportedError: GrpcPushNotificationNotSupportedError,
  UnsupportedOperationError: GrpcUnsupportedOperationError,
  ContentTypeNotSupportedError: GrpcContentTypeNotSupportedError,
  InvalidAgentResponseError: GrpcInvalidAgentResponseError,
  ExtendedAgentCardNotConfiguredError: GrpcExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError: GrpcExtensionSupportRequiredError,
  VersionNotSupportedError: GrpcVersionNotSupportedError,
  RequestMalformedError: GrpcRequestMalformedError,
  GenericError: GrpcGenericError,
});

/** Returns the gRPC status the server should send for a given error. */
export function grpcStatusFor(error: unknown): number {
  if (isGrpcError(error)) return error.status;
  if (error instanceof A2AError)
    return A2A_ERROR_SPECS[error.name]?.grpcStatus ?? GRPC_STATUS.UNKNOWN;
  return GRPC_STATUS.UNKNOWN;
}

/** Encodes a `google.rpc.Status` + `ErrorInfo` blob for `grpc-status-details-bin`. */
export function encodeGrpcStatusDetails(
  status: number,
  message: string,
  reason: string,
  metadata?: Record<string, string>
): Buffer {
  const errorInfoBytes = Buffer.from(
    ErrorInfo.encode({ reason, domain: A2A_ERROR_DOMAIN, metadata: metadata ?? {} }).finish()
  );
  return Buffer.from(
    Status.encode({
      code: status,
      message,
      details: [{ typeUrl: ERROR_INFO_TYPE, value: errorInfoBytes }],
    }).finish()
  );
}

/** Builds trailing gRPC metadata carrying the encoded status blob, or `undefined` if unknown error. */
export function buildGrpcErrorMetadata(
  Metadata: typeof grpc.Metadata,
  error: unknown
): grpc.Metadata | undefined {
  if (!(error instanceof A2AError)) return undefined;
  const spec = A2A_ERROR_SPECS[error.name];
  if (!spec) return undefined;
  const blob = encodeGrpcStatusDetails(
    grpcStatusFor(error),
    error.message,
    spec.reason,
    error.metadata
  );
  const md = new Metadata();
  md.set(GRPC_STATUS_DETAILS_BIN, blob);
  return md;
}

/** Decoded shape of a `google.rpc.Status`. */
export interface DecodedStatus {
  code: number;
  message: string;
  details: Any[];
}

/** Decoded shape of a `google.rpc.ErrorInfo`. */
export interface DecodedErrorInfo {
  reason: string;
  domain: string;
  metadata: Record<string, string>;
}

/** Decodes `google.rpc.Status` from a `grpc-status-details-bin` buffer. */
export function decodeStatus(buffer: Buffer): DecodedStatus {
  return Status.decode(new Uint8Array(buffer));
}

/** Decodes `google.rpc.ErrorInfo` from a buffer. */
export function decodeErrorInfo(buffer: Buffer): DecodedErrorInfo {
  return ErrorInfo.decode(new Uint8Array(buffer));
}

/**
 * Rebuilds a gRPC-specific SDK error from a `grpc.ServiceError`. Reads
 * `grpc-status-details-bin` for `ErrorInfo.reason`; falls back to
 * {@link GrpcGenericError} carrying the raw status and details string.
 * `method` is included in the fallback message for debuggability.
 */
export function fromGrpcError(error: grpc.ServiceError, method?: string): GrpcA2AError {
  const bin = error.metadata?.get(GRPC_STATUS_DETAILS_BIN);
  let statusDetailsBin: Buffer | undefined;
  if (bin && bin.length > 0) {
    const raw = bin[0];
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'binary');
    statusDetailsBin = buffer;
    const status = decodeStatus(buffer);
    for (const detail of status.details) {
      if (detail.typeUrl === ERROR_INFO_TYPE) {
        const info = decodeErrorInfo(detail.value);
        const spec = A2A_ERROR_SPECS_BY_REASON[info.reason];
        if (spec) {
          const metadata =
            info.domain === A2A_ERROR_DOMAIN && info.metadata ? info.metadata : undefined;
          return new GRPC_ERROR_CLASSES[spec.name]({
            message: error.details || status.message,
            metadata,
            status: error.code,
            statusDetailsBin,
          });
        }
      }
    }
  }
  const suffix = method ? ` for ${method}` : '';
  return new GrpcGenericError({
    message:
      `gRPC error${suffix}: ${error.code ?? GRPC_STATUS.UNKNOWN} ${error.details ?? ''}`.trim(),
    cause: error,
    status: error.code ?? GRPC_STATUS.UNKNOWN,
    statusDetailsBin,
  });
}

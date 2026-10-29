/**
 * gRPC transport error subclasses and wire helpers. Absorbs the
 * previous `src/server/grpc/error_details.ts`.
 *
 * Owns the gRPC status enum ({@link GRPC_STATUS_CODE}) and the
 * per-error status mapping (§5.4). `../base.ts` intentionally carries
 * only §3.3.2 fields; codes are transport-specific.
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
} from '../base.js';
import { Any } from '../../grpc/pb/google/protobuf/any.js';
import { ErrorInfo } from '../../grpc/pb/google/rpc/error_details.js';
import { Status } from '../../grpc/pb/google/rpc/status.js';

/** Trailing metadata key for `google.rpc.Status`. */
export const GRPC_STATUS_DETAILS_BIN = 'grpc-status-details-bin';

/**
 * Numeric gRPC status codes. Mirrors `@grpc/grpc-js`'s `status` enum
 * so callers can use these values interchangeably with the grpc-js
 * runtime enum. Declared locally so `./base.ts` stays pb/grpc-free.
 */
export const GRPC_STATUS_CODE = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
} as const;

/** Per-error gRPC status (§5.4). Semantic class name -> status code. */
const GRPC_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  TaskNotFoundError: GRPC_STATUS_CODE.NOT_FOUND,
  TaskNotCancelableError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  PushNotificationNotSupportedError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  UnsupportedOperationError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  ContentTypeNotSupportedError: GRPC_STATUS_CODE.INVALID_ARGUMENT,
  InvalidAgentResponseError: GRPC_STATUS_CODE.INTERNAL,
  ExtendedAgentCardNotConfiguredError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  ExtensionSupportRequiredError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  VersionNotSupportedError: GRPC_STATUS_CODE.FAILED_PRECONDITION,
  RequestMalformedError: GRPC_STATUS_CODE.INVALID_ARGUMENT,
});

/** Transport context carried by every `Grpc*Error`. */
export interface GrpcA2AError extends A2AError {
  readonly transport: 'grpc';
  readonly status: number;
  /** Raw `grpc-status-details-bin` blob for callers that want to re-encode. */
  readonly statusDetailsBin?: Buffer;
}

/** Options accepted by every `Grpc*Error` constructor. */
export interface GrpcA2AErrorOptions extends A2AErrorOptions {
  /** gRPC status code. Defaults to the per-error spec value. */
  status?: number;
  /** Raw `grpc-status-details-bin` blob if received on the wire. */
  statusDetailsBin?: Buffer;
}

/** Type guard narrowing an unknown / `A2AError` to {@link GrpcA2AError}. */
export function isGrpcError(err: unknown): err is GrpcA2AError {
  return err instanceof A2AError && (err as { transport?: string }).transport === 'grpc';
}

function makeGrpc(name: string): new (options?: GrpcA2AErrorOptions) => GrpcA2AError {
  const Base = A2A_ERROR_CLASSES[name];
  const defaultStatus = GRPC_ERROR_STATUS[name] ?? GRPC_STATUS_CODE.INTERNAL;
  const cls = {
    [`Grpc${name}`]: class extends Base {
      public readonly transport = 'grpc';
      public readonly status: number;
      public readonly statusDetailsBin?: Buffer;
      constructor(options?: GrpcA2AErrorOptions) {
        super(options);
        this.name = name;
        this.status = options?.status ?? defaultStatus;
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

/** gRPC twins indexed by their semantic parent's name. */
const GRPC_ERROR_CLASSES: Readonly<
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
});

/** Returns the gRPC status the server should send for a given error. */
export function grpcStatusFor(error: unknown): number {
  if (isGrpcError(error)) return error.status;
  if (error instanceof A2AError) return GRPC_ERROR_STATUS[error.name] ?? GRPC_STATUS_CODE.UNKNOWN;
  return GRPC_STATUS_CODE.UNKNOWN;
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
 * `grpc-status-details-bin` for `ErrorInfo.reason`; falls back to a
 * gRPC-scoped concrete {@link A2AError} carrying the raw status and
 * details string. `method` is included in the fallback message for
 * debuggability.
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
  return new GrpcA2AErrorImpl({
    message:
      `gRPC error${suffix}: ${error.code ?? GRPC_STATUS_CODE.UNKNOWN} ${error.details ?? ''}`.trim(),
    cause: error,
    status: error.code ?? GRPC_STATUS_CODE.UNKNOWN,
    statusDetailsBin,
  });
}

/**
 * Concrete gRPC-scoped {@link A2AError} used when the wire has no
 * `ErrorInfo` detail. Kept private because callers shouldn't be
 * constructing it directly.
 */
class GrpcA2AErrorImpl extends A2AError implements GrpcA2AError {
  public readonly transport = 'grpc';
  public readonly status: number;
  public readonly statusDetailsBin?: Buffer;
  constructor(options?: GrpcA2AErrorOptions) {
    super(options);
    this.name = 'A2AError';
    this.status = options?.status ?? GRPC_STATUS_CODE.UNKNOWN;
    if (options?.statusDetailsBin) this.statusDetailsBin = options.statusDetailsBin;
  }
}

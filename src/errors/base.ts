/**
 * Transport-agnostic A2A error hierarchy shared by client and server.
 *
 * Every SDK error extends {@link A2AError}. Transport-specific subclasses
 * (in `./rest`, `./grpc`, `./json_rpc`) mix in a transport-context
 * interface; catch sites narrow via `instanceof <SemanticError>` and
 * `isRestError` / `isGrpcError` / `isJsonRpcError` type guards.
 */

/** JSON-RPC 2.0 error codes reserved for A2A. */
export const A2A_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  EXTENDED_CARD_NOT_CONFIGURED: -32007,
  EXTENSION_SUPPORT_REQUIRED: -32008,
  VERSION_NOT_SUPPORTED: -32009,
} as const;

/** Domain for `google.rpc.ErrorInfo.domain`. */
export const A2A_ERROR_DOMAIN = 'a2a-protocol.org';

/** `@type`/`typeUrl` for `google.rpc.ErrorInfo` in ProtoJSON `Any`. */
export const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo';

/** HTTP status codes used in REST responses. */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
} as const;

/**
 * Canonical numeric status codes used by the semantic-error registry
 * to describe the spec-mapped status per §5.4. The numeric namespace
 * matches gRPC's `status` enum (so the gRPC transport can emit them
 * directly) and the string form (see {@link A2A_STATUS_NAME}) fills
 * the REST body's `status` field per §11.6.
 */
export const A2A_STATUS_CODE = {
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

/**
 * String form of {@link A2A_STATUS_CODE}, used in the REST body's
 * `status` field per §11.6. Names follow the gRPC enum form.
 */
export const A2A_STATUS_NAME: Readonly<Record<number, string>> = {
  [A2A_STATUS_CODE.OK]: 'OK',
  [A2A_STATUS_CODE.CANCELLED]: 'CANCELLED',
  [A2A_STATUS_CODE.UNKNOWN]: 'UNKNOWN',
  [A2A_STATUS_CODE.INVALID_ARGUMENT]: 'INVALID_ARGUMENT',
  [A2A_STATUS_CODE.DEADLINE_EXCEEDED]: 'DEADLINE_EXCEEDED',
  [A2A_STATUS_CODE.NOT_FOUND]: 'NOT_FOUND',
  [A2A_STATUS_CODE.ALREADY_EXISTS]: 'ALREADY_EXISTS',
  [A2A_STATUS_CODE.PERMISSION_DENIED]: 'PERMISSION_DENIED',
  [A2A_STATUS_CODE.RESOURCE_EXHAUSTED]: 'RESOURCE_EXHAUSTED',
  [A2A_STATUS_CODE.FAILED_PRECONDITION]: 'FAILED_PRECONDITION',
  [A2A_STATUS_CODE.ABORTED]: 'ABORTED',
  [A2A_STATUS_CODE.OUT_OF_RANGE]: 'OUT_OF_RANGE',
  [A2A_STATUS_CODE.UNIMPLEMENTED]: 'UNIMPLEMENTED',
  [A2A_STATUS_CODE.INTERNAL]: 'INTERNAL',
  [A2A_STATUS_CODE.UNAVAILABLE]: 'UNAVAILABLE',
  [A2A_STATUS_CODE.DATA_LOSS]: 'DATA_LOSS',
  [A2A_STATUS_CODE.UNAUTHENTICATED]: 'UNAUTHENTICATED',
};

/** A structured detail object included in error responses. */
export interface ErrorDetail {
  '@type': string;
  [key: string]: unknown;
}

/** `google.rpc.ErrorInfo` as it travels on any A2A wire. */
export interface A2AErrorInfo extends ErrorDetail {
  '@type': typeof ERROR_INFO_TYPE;
  reason: string;
  domain: typeof A2A_ERROR_DOMAIN;
  metadata?: Record<string, string>;
}

/** REST error body (`google.rpc.Status` JSON). */
export interface RestErrorBody {
  error: {
    code: number;
    status: string;
    message: string;
    details: ErrorDetail[];
  };
}

/** Options accepted by every `A2AError` constructor. */
export interface A2AErrorOptions {
  /** Human-readable message. If omitted, the per-class default is used. */
  message?: string;
  /** Original error / rejection reason (see `Error.cause`). */
  cause?: unknown;
  /** Free-form ErrorInfo.metadata carried on the wire when possible. */
  metadata?: Record<string, string>;
}

/**
 * Base class for every SDK error. Carries the spec-aligned `reason`,
 * numeric `code`, and structured `metadata`. Concrete semantic classes
 * (below) fill in `reason` / `code` in their constructor. Transport
 * subclasses in `./rest`, `./grpc`, `./json_rpc` add wire context via
 * the {@link RestA2AError} / {@link GrpcA2AError} / {@link JsonRpcA2AError}
 * interfaces.
 */
export class A2AError extends Error {
  /** UPPER_SNAKE_CASE reason from `google.rpc.ErrorInfo`. */
  public readonly reason: string = 'INTERNAL_ERROR';
  /** Numeric JSON-RPC / A2A error code. */
  public readonly code: number = A2A_ERROR_CODE.INTERNAL_ERROR;
  /** Optional `google.rpc.ErrorInfo.metadata`. */
  public readonly metadata?: Record<string, string>;

  constructor(defaultMessage: string, options?: A2AErrorOptions) {
    super(
      options?.message ?? defaultMessage,
      options?.cause !== undefined ? { cause: options.cause } : undefined
    );
    this.name = new.target.name;
    if (options?.metadata && Object.keys(options.metadata).length > 0) {
      this.metadata = options.metadata;
    }
  }

  /** Builds `google.rpc.ErrorInfo` from this error. */
  public toErrorInfo(): A2AErrorInfo {
    return {
      '@type': ERROR_INFO_TYPE,
      reason: this.reason,
      domain: A2A_ERROR_DOMAIN,
      ...(this.metadata ? { metadata: this.metadata } : {}),
    };
  }
}

/**
 * Registry row for one semantic error class. Adding a new error means
 * adding one row here; all wire mappings derive from it.
 */
export interface A2AErrorSpec {
  name: string;
  reason: string;
  code: number;
  grpcStatus: number;
  httpStatus: number;
  defaultMessage: string;
}

const specs: A2AErrorSpec[] = [
  {
    name: 'TaskNotFoundError',
    reason: 'TASK_NOT_FOUND',
    code: A2A_ERROR_CODE.TASK_NOT_FOUND,
    grpcStatus: A2A_STATUS_CODE.NOT_FOUND,
    httpStatus: HTTP_STATUS.NOT_FOUND,
    defaultMessage: 'Task not found',
  },
  {
    name: 'TaskNotCancelableError',
    reason: 'TASK_NOT_CANCELABLE',
    code: A2A_ERROR_CODE.TASK_NOT_CANCELABLE,
    grpcStatus: A2A_STATUS_CODE.FAILED_PRECONDITION,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    defaultMessage: 'Task cannot be canceled',
  },
  {
    name: 'PushNotificationNotSupportedError',
    reason: 'PUSH_NOTIFICATION_NOT_SUPPORTED',
    code: A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED,
    grpcStatus: A2A_STATUS_CODE.FAILED_PRECONDITION,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    defaultMessage: 'Push Notification is not supported',
  },
  {
    name: 'UnsupportedOperationError',
    reason: 'UNSUPPORTED_OPERATION',
    code: A2A_ERROR_CODE.UNSUPPORTED_OPERATION,
    grpcStatus: A2A_STATUS_CODE.FAILED_PRECONDITION,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    defaultMessage: 'This operation is not supported',
  },
  {
    name: 'ContentTypeNotSupportedError',
    reason: 'CONTENT_TYPE_NOT_SUPPORTED',
    code: A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED,
    grpcStatus: A2A_STATUS_CODE.INVALID_ARGUMENT,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    defaultMessage: 'Incompatible content types',
  },
  {
    name: 'InvalidAgentResponseError',
    reason: 'INVALID_AGENT_RESPONSE',
    code: A2A_ERROR_CODE.INVALID_AGENT_RESPONSE,
    grpcStatus: A2A_STATUS_CODE.INTERNAL,
    httpStatus: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    defaultMessage: 'Invalid agent response type',
  },
  {
    name: 'ExtendedAgentCardNotConfiguredError',
    reason: 'EXTENDED_AGENT_CARD_NOT_CONFIGURED',
    code: A2A_ERROR_CODE.EXTENDED_CARD_NOT_CONFIGURED,
    grpcStatus: A2A_STATUS_CODE.FAILED_PRECONDITION,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    defaultMessage: 'Extended Agent Card not configured',
  },
  {
    name: 'ExtensionSupportRequiredError',
    reason: 'EXTENSION_SUPPORT_REQUIRED',
    code: A2A_ERROR_CODE.EXTENSION_SUPPORT_REQUIRED,
    grpcStatus: A2A_STATUS_CODE.FAILED_PRECONDITION,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    defaultMessage: 'Extension support required',
  },
  {
    name: 'VersionNotSupportedError',
    reason: 'VERSION_NOT_SUPPORTED',
    code: A2A_ERROR_CODE.VERSION_NOT_SUPPORTED,
    grpcStatus: A2A_STATUS_CODE.FAILED_PRECONDITION,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    defaultMessage: 'Version not supported',
  },
  {
    name: 'RequestMalformedError',
    reason: 'INVALID_PARAMS',
    code: A2A_ERROR_CODE.INVALID_PARAMS,
    grpcStatus: A2A_STATUS_CODE.INVALID_ARGUMENT,
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    defaultMessage: 'Request malformed',
  },
  {
    name: 'GenericError',
    reason: 'INTERNAL_ERROR',
    code: A2A_ERROR_CODE.INTERNAL_ERROR,
    grpcStatus: A2A_STATUS_CODE.INTERNAL,
    httpStatus: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    defaultMessage: 'An unexpected error occurred.',
  },
];

/** Registry lookups keyed on the various identifiers used across wires. */
export const A2A_ERROR_SPECS: Readonly<Record<string, A2AErrorSpec>> = Object.freeze(
  Object.fromEntries(specs.map((s) => [s.name, s]))
);
export const A2A_ERROR_SPECS_BY_REASON: Readonly<Record<string, A2AErrorSpec>> = Object.freeze(
  Object.fromEntries(specs.map((s) => [s.reason, s]))
);
export const A2A_ERROR_SPECS_BY_CODE: Readonly<Record<number, A2AErrorSpec>> = Object.freeze(
  Object.fromEntries(specs.map((s) => [s.code, s]))
);

/**
 * Concrete semantic error classes. One per {@link A2AErrorSpec} row.
 * Generated by {@link makeSemantic} so adding a new row automatically
 * produces a class with the right `name`, `reason`, `code`, and default
 * message. Transport variants are declared in `./rest`, `./grpc`,
 * `./json_rpc`.
 */
function makeSemantic(spec: A2AErrorSpec): new (options?: A2AErrorOptions | string) => A2AError {
  // Named class so `error.name` and stack traces match the spec.
  const cls = {
    [spec.name]: class extends A2AError {
      public override readonly reason = spec.reason;
      public override readonly code = spec.code;
      constructor(options?: A2AErrorOptions | string) {
        super(spec.defaultMessage, typeof options === 'string' ? { message: options } : options);
      }
    },
  }[spec.name];
  return cls as new (options?: A2AErrorOptions | string) => A2AError;
}

export const TaskNotFoundError = makeSemantic(A2A_ERROR_SPECS.TaskNotFoundError);
export type TaskNotFoundError = InstanceType<typeof TaskNotFoundError>;

export const TaskNotCancelableError = makeSemantic(A2A_ERROR_SPECS.TaskNotCancelableError);
export type TaskNotCancelableError = InstanceType<typeof TaskNotCancelableError>;

export const PushNotificationNotSupportedError = makeSemantic(
  A2A_ERROR_SPECS.PushNotificationNotSupportedError
);
export type PushNotificationNotSupportedError = InstanceType<
  typeof PushNotificationNotSupportedError
>;

export const UnsupportedOperationError = makeSemantic(A2A_ERROR_SPECS.UnsupportedOperationError);
export type UnsupportedOperationError = InstanceType<typeof UnsupportedOperationError>;

export const ContentTypeNotSupportedError = makeSemantic(
  A2A_ERROR_SPECS.ContentTypeNotSupportedError
);
export type ContentTypeNotSupportedError = InstanceType<typeof ContentTypeNotSupportedError>;

export const InvalidAgentResponseError = makeSemantic(A2A_ERROR_SPECS.InvalidAgentResponseError);
export type InvalidAgentResponseError = InstanceType<typeof InvalidAgentResponseError>;

export const ExtendedAgentCardNotConfiguredError = makeSemantic(
  A2A_ERROR_SPECS.ExtendedAgentCardNotConfiguredError
);
export type ExtendedAgentCardNotConfiguredError = InstanceType<
  typeof ExtendedAgentCardNotConfiguredError
>;

export const ExtensionSupportRequiredError = makeSemantic(
  A2A_ERROR_SPECS.ExtensionSupportRequiredError
);
export type ExtensionSupportRequiredError = InstanceType<typeof ExtensionSupportRequiredError>;

export const VersionNotSupportedError = makeSemantic(A2A_ERROR_SPECS.VersionNotSupportedError);
export type VersionNotSupportedError = InstanceType<typeof VersionNotSupportedError>;

export const RequestMalformedError = makeSemantic(A2A_ERROR_SPECS.RequestMalformedError);
export type RequestMalformedError = InstanceType<typeof RequestMalformedError>;

export const GenericError = makeSemantic(A2A_ERROR_SPECS.GenericError);
export type GenericError = InstanceType<typeof GenericError>;

/** Constructor type of a semantic {@link A2AError} subclass. */
export type A2AErrorClass = new (options?: A2AErrorOptions | string) => A2AError;

/** All semantic error classes indexed by their name. */
export const A2A_ERROR_CLASSES: Readonly<Record<string, A2AErrorClass>> = Object.freeze({
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
});

/**
 * Coerces an arbitrary rejected-promise reason into a printable message.
 * Promise rejections are not required to be `Error` instances.
 */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err === null || err === undefined) return String(err);
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Looks up the {@link A2AErrorSpec} matching an `Error` instance by
 * class name. Returns `undefined` for non-A2A errors.
 */
export function specForError(error: unknown): A2AErrorSpec | undefined {
  if (!(error instanceof Error)) return undefined;
  return A2A_ERROR_SPECS[error.name];
}

/**
 * Backward-compat shim retained for callers that still pass a `{ code,
 * message }` pair. Use {@link A2A_ERROR_SPECS_BY_CODE} plus a class
 * constructor directly when writing new code.
 */
export function errorForCode(code: number, message: string): A2AError {
  const spec = A2A_ERROR_SPECS_BY_CODE[code];
  const cls = spec ? A2A_ERROR_CLASSES[spec.name] : A2A_ERROR_CLASSES.GenericError;
  return new cls({ message });
}

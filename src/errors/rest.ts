/**
 * REST/HTTP+JSON transport error subclasses and wire helpers.
 *
 * Every semantic error has a REST twin (e.g. `RestTaskNotFoundError`)
 * that carries HTTP status, response headers, and `cause`. All REST
 * twins satisfy {@link RestA2AError}; narrow via {@link isRestError}.
 *
 * The per-error HTTP status mapping (§5.4) and the `status` string
 * enum used in the REST body (§11.6) live here rather than in
 * `./base.ts` so `base.ts` carries only spec-defined §3.3.2 fields.
 */

import {
  A2A_ERROR_CLASSES,
  A2A_ERROR_DOMAIN,
  A2A_ERROR_SPECS_BY_REASON,
  A2AError,
  type A2AErrorOptions,
  ERROR_INFO_TYPE,
  type ErrorDetail,
} from './base.js';

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
 * `status` string used in the REST body per §11.6. Names follow the
 * gRPC enum; values are the same numeric codes.
 */
export const REST_STATUS_NAME = {
  OK: 'OK',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  DEADLINE_EXCEEDED: 'DEADLINE_EXCEEDED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  FAILED_PRECONDITION: 'FAILED_PRECONDITION',
  ABORTED: 'ABORTED',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  UNIMPLEMENTED: 'UNIMPLEMENTED',
  INTERNAL: 'INTERNAL',
  UNAVAILABLE: 'UNAVAILABLE',
  DATA_LOSS: 'DATA_LOSS',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
} as const;

/** REST error body (`google.rpc.Status` JSON). */
export interface RestErrorBody {
  error: {
    code: number;
    status: string;
    message: string;
    details: ErrorDetail[];
  };
}

/**
 * Per-error HTTP status mapping (§5.4). Semantic class name -> status.
 * Errors that also want to advertise a stringy `status` in the REST
 * body use {@link REST_ERROR_STATUS_NAME}.
 */
export const REST_ERROR_HTTP_STATUS: Readonly<Record<string, number>> = Object.freeze({
  TaskNotFoundError: HTTP_STATUS.NOT_FOUND,
  TaskNotCancelableError: HTTP_STATUS.BAD_REQUEST,
  PushNotificationNotSupportedError: HTTP_STATUS.BAD_REQUEST,
  UnsupportedOperationError: HTTP_STATUS.BAD_REQUEST,
  ContentTypeNotSupportedError: HTTP_STATUS.BAD_REQUEST,
  InvalidAgentResponseError: HTTP_STATUS.INTERNAL_SERVER_ERROR,
  ExtendedAgentCardNotConfiguredError: HTTP_STATUS.BAD_REQUEST,
  ExtensionSupportRequiredError: HTTP_STATUS.BAD_REQUEST,
  VersionNotSupportedError: HTTP_STATUS.BAD_REQUEST,
  RequestMalformedError: HTTP_STATUS.BAD_REQUEST,
});

/**
 * Per-error `status` string for the REST body (§11.6). Semantic class
 * name -> status name (from {@link REST_STATUS_NAME}).
 */
export const REST_ERROR_STATUS_NAME: Readonly<Record<string, string>> = Object.freeze({
  TaskNotFoundError: REST_STATUS_NAME.NOT_FOUND,
  TaskNotCancelableError: REST_STATUS_NAME.FAILED_PRECONDITION,
  PushNotificationNotSupportedError: REST_STATUS_NAME.FAILED_PRECONDITION,
  UnsupportedOperationError: REST_STATUS_NAME.FAILED_PRECONDITION,
  ContentTypeNotSupportedError: REST_STATUS_NAME.INVALID_ARGUMENT,
  InvalidAgentResponseError: REST_STATUS_NAME.INTERNAL,
  ExtendedAgentCardNotConfiguredError: REST_STATUS_NAME.FAILED_PRECONDITION,
  ExtensionSupportRequiredError: REST_STATUS_NAME.FAILED_PRECONDITION,
  VersionNotSupportedError: REST_STATUS_NAME.FAILED_PRECONDITION,
  RequestMalformedError: REST_STATUS_NAME.INVALID_ARGUMENT,
});

/** Transport context carried by every `Rest*Error`. */
export interface RestA2AError extends A2AError {
  readonly transport: 'rest';
  readonly statusCode: number;
  readonly headers?: Record<string, string | string[]>;
}

/** Options accepted by every `Rest*Error` constructor. */
export interface RestA2AErrorOptions extends A2AErrorOptions {
  /** HTTP status code. Defaults to the semantic error's spec value. */
  statusCode?: number;
  /** Response headers seen on the wire (client-side) or to send (server-side). */
  headers?: Record<string, string | string[]>;
}

/**
 * Type guard for {@link RestA2AError}. Narrows an unknown / `A2AError`
 * to the REST interface so callers can access `statusCode`, `headers`.
 */
export function isRestError(err: unknown): err is RestA2AError {
  return err instanceof A2AError && (err as { transport?: string }).transport === 'rest';
}

/** Builds the REST twin of a semantic error class. */
function makeRest(name: string): new (options?: RestA2AErrorOptions) => RestA2AError {
  const Base = A2A_ERROR_CLASSES[name];
  const defaultStatus = REST_ERROR_HTTP_STATUS[name] ?? HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const cls = {
    [`Rest${name}`]: class extends Base {
      public readonly transport = 'rest';
      public readonly statusCode: number;
      public readonly headers?: Record<string, string | string[]>;
      constructor(options?: RestA2AErrorOptions) {
        super(options);
        // Keep `error.name` aligned with the semantic class so
        // `error.name === 'TaskNotFoundError'` still holds.
        this.name = name;
        this.statusCode = options?.statusCode ?? defaultStatus;
        if (options?.headers) this.headers = options.headers;
      }
    },
  }[`Rest${name}`];
  return cls as unknown as new (options?: RestA2AErrorOptions) => RestA2AError;
}

// One concrete class per semantic error. Boring but required for
// `instanceof RestTaskNotFoundError`.
export const RestTaskNotFoundError = makeRest('TaskNotFoundError');
export type RestTaskNotFoundError = InstanceType<typeof RestTaskNotFoundError>;

export const RestTaskNotCancelableError = makeRest('TaskNotCancelableError');
export type RestTaskNotCancelableError = InstanceType<typeof RestTaskNotCancelableError>;

export const RestPushNotificationNotSupportedError = makeRest('PushNotificationNotSupportedError');
export type RestPushNotificationNotSupportedError = InstanceType<
  typeof RestPushNotificationNotSupportedError
>;

export const RestUnsupportedOperationError = makeRest('UnsupportedOperationError');
export type RestUnsupportedOperationError = InstanceType<typeof RestUnsupportedOperationError>;

export const RestContentTypeNotSupportedError = makeRest('ContentTypeNotSupportedError');
export type RestContentTypeNotSupportedError = InstanceType<
  typeof RestContentTypeNotSupportedError
>;

export const RestInvalidAgentResponseError = makeRest('InvalidAgentResponseError');
export type RestInvalidAgentResponseError = InstanceType<typeof RestInvalidAgentResponseError>;

export const RestExtendedAgentCardNotConfiguredError = makeRest(
  'ExtendedAgentCardNotConfiguredError'
);
export type RestExtendedAgentCardNotConfiguredError = InstanceType<
  typeof RestExtendedAgentCardNotConfiguredError
>;

export const RestExtensionSupportRequiredError = makeRest('ExtensionSupportRequiredError');
export type RestExtensionSupportRequiredError = InstanceType<
  typeof RestExtensionSupportRequiredError
>;

export const RestVersionNotSupportedError = makeRest('VersionNotSupportedError');
export type RestVersionNotSupportedError = InstanceType<typeof RestVersionNotSupportedError>;

export const RestRequestMalformedError = makeRest('RequestMalformedError');
export type RestRequestMalformedError = InstanceType<typeof RestRequestMalformedError>;

/** REST twins indexed by their semantic parent's name. */
export const REST_ERROR_CLASSES: Readonly<
  Record<string, new (options?: RestA2AErrorOptions) => RestA2AError>
> = Object.freeze({
  TaskNotFoundError: RestTaskNotFoundError,
  TaskNotCancelableError: RestTaskNotCancelableError,
  PushNotificationNotSupportedError: RestPushNotificationNotSupportedError,
  UnsupportedOperationError: RestUnsupportedOperationError,
  ContentTypeNotSupportedError: RestContentTypeNotSupportedError,
  InvalidAgentResponseError: RestInvalidAgentResponseError,
  ExtendedAgentCardNotConfiguredError: RestExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError: RestExtensionSupportRequiredError,
  VersionNotSupportedError: RestVersionNotSupportedError,
  RequestMalformedError: RestRequestMalformedError,
});

/**
 * Returns the HTTP status the server should send for a given error.
 * Uses the semantic mapping; falls back to 500 for unknown throwables.
 */
export function restStatusFor(error: unknown): number {
  if (isRestError(error)) return error.statusCode;
  if (error instanceof A2AError) return REST_ERROR_HTTP_STATUS[error.name] ?? 500;
  return HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

/**
 * Serializes an error as a `google.rpc.Status` JSON body (§11.6).
 * The `status` field uses the per-error name from
 * {@link REST_ERROR_STATUS_NAME}; falls back to a coarse HTTP-status
 * mapping for non-A2A throwables.
 */
export function toRestErrorBody(error: unknown, httpStatus: number): RestErrorBody {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  const details: ErrorDetail[] = [];
  let statusName: string = REST_STATUS_NAME.UNKNOWN;

  if (error instanceof A2AError) {
    details.push(error.toErrorInfo());
    statusName = REST_ERROR_STATUS_NAME[error.name] ?? REST_STATUS_NAME.UNKNOWN;
  } else if (httpStatus === HTTP_STATUS.NOT_FOUND) statusName = REST_STATUS_NAME.NOT_FOUND;
  else if (httpStatus === HTTP_STATUS.INTERNAL_SERVER_ERROR) statusName = REST_STATUS_NAME.INTERNAL;
  else if (httpStatus === HTTP_STATUS.BAD_REQUEST) statusName = REST_STATUS_NAME.INVALID_ARGUMENT;

  return { error: { code: httpStatus, status: statusName, message, details } };
}

/**
 * Rebuilds a REST-specific SDK error from a parsed error body.
 * `details[]` is scanned for `ErrorInfo`; if found, its `reason`
 * selects the semantic twin. Otherwise falls back to a REST-scoped
 * concrete {@link A2AError} carrying the raw message.
 */
export function fromRestErrorBody(
  body: {
    message?: string;
    code?: number;
    status?: string;
    details?: Array<Record<string, unknown>>;
  },
  transportCtx: { statusCode: number; headers?: Record<string, string | string[]> }
): RestA2AError {
  const message = body.message || 'Unknown error';
  const details = body.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d['@type'] === ERROR_INFO_TYPE && typeof d.reason === 'string') {
        const spec = A2A_ERROR_SPECS_BY_REASON[d.reason];
        if (spec) {
          const metadata =
            d.domain === A2A_ERROR_DOMAIN && d.metadata && typeof d.metadata === 'object'
              ? (d.metadata as Record<string, string>)
              : undefined;
          return new REST_ERROR_CLASSES[spec.name]({ message, metadata, ...transportCtx });
        }
      }
    }
  }
  return new RestA2AErrorImpl({ message, ...transportCtx });
}

/**
 * Concrete REST-scoped {@link A2AError} used when the wire has no
 * `ErrorInfo` detail (the "unknown" bucket). Kept private because
 * callers shouldn't be constructing it directly.
 */
class RestA2AErrorImpl extends A2AError implements RestA2AError {
  public readonly transport = 'rest';
  public readonly statusCode: number;
  public readonly headers?: Record<string, string | string[]>;
  constructor(options?: RestA2AErrorOptions) {
    super(options);
    this.name = 'A2AError';
    this.statusCode = options?.statusCode ?? HTTP_STATUS.INTERNAL_SERVER_ERROR;
    if (options?.headers) this.headers = options.headers;
  }
}

/**
 * REST/HTTP+JSON transport error subclasses and wire helpers.
 *
 * Every semantic error has a REST twin (e.g. `RestTaskNotFoundError`)
 * that carries HTTP status, response headers, and `cause`. All REST
 * twins satisfy {@link RestA2AError}; narrow via {@link isRestError}.
 */

import {
  A2A_ERROR_CLASSES,
  A2A_ERROR_DOMAIN,
  A2A_ERROR_SPECS,
  A2A_ERROR_SPECS_BY_REASON,
  A2AError,
  type A2AErrorOptions,
  ERROR_INFO_TYPE,
  type ErrorDetail,
  A2A_STATUS_NAME,
  HTTP_STATUS,
  type RestErrorBody,
} from './base.js';

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
  const spec = A2A_ERROR_SPECS[name];
  const Base = A2A_ERROR_CLASSES[name];
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
        this.statusCode = options?.statusCode ?? spec.httpStatus;
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

export const RestGenericError = makeRest('GenericError');
export type RestGenericError = InstanceType<typeof RestGenericError>;

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
  GenericError: RestGenericError,
});

/**
 * Returns the HTTP status the server should send for a given error.
 * Uses the semantic spec; falls back to 500 for unknown throwables.
 */
export function restStatusFor(error: unknown): number {
  if (isRestError(error)) return error.statusCode;
  if (error instanceof A2AError) return A2A_ERROR_SPECS[error.name]?.httpStatus ?? 500;
  return HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

/**
 * Serializes an error as a `google.rpc.Status` JSON body.
 * The `status` field uses the gRPC status name (from the semantic
 * spec if available, otherwise inferred from `httpStatus`).
 */
export function toRestErrorBody(error: unknown, httpStatus: number): RestErrorBody {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  const details: ErrorDetail[] = [];
  let statusName = 'UNKNOWN';

  if (error instanceof A2AError) {
    details.push(error.toErrorInfo());
    const spec = A2A_ERROR_SPECS[error.name];
    statusName = spec ? (A2A_STATUS_NAME[spec.grpcStatus] ?? 'UNKNOWN') : 'UNKNOWN';
  } else if (httpStatus === HTTP_STATUS.NOT_FOUND) statusName = 'NOT_FOUND';
  else if (httpStatus === HTTP_STATUS.INTERNAL_SERVER_ERROR) statusName = 'INTERNAL';
  else if (httpStatus === HTTP_STATUS.BAD_REQUEST) statusName = 'INVALID_ARGUMENT';

  return { error: { code: httpStatus, status: statusName, message, details } };
}

/**
 * Rebuilds a REST-specific SDK error from a parsed error body.
 * `details[]` is scanned for `ErrorInfo`; if found, its `reason`
 * selects the semantic twin. Otherwise falls back to
 * {@link RestGenericError} with the raw message.
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
  return new RestGenericError({ message, ...transportCtx });
}

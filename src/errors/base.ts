/**
 * Transport-agnostic A2A error hierarchy shared by client and server.
 *
 * Every SDK error extends {@link A2AError}. Transport-specific subclasses
 * (in `./rest`, `./grpc`, `./json_rpc`) mix in a transport-context
 * interface; catch sites narrow via `instanceof <SemanticError>` and
 * `isRestError` / `isGrpcError` / `isJsonRpcError` type guards.
 *
 * Only the spec-defined fields (§3.3.2 "A2A-Specific Errors") live
 * here: `name`, `reason` (`ErrorInfo.reason`), and a default message.
 * Per-transport code/status mappings (§5.4) live in the corresponding
 * transport files.
 */

/** Domain for `google.rpc.ErrorInfo.domain`. */
export const A2A_ERROR_DOMAIN = 'a2a-protocol.org';

/** `@type`/`typeUrl` for `google.rpc.ErrorInfo` in ProtoJSON `Any`. */
export const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo';

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
 * Realm-wide brand carried by every {@link A2AError}.
 *
 * The package ships one bundle per entry point and each bundle inlines
 * its own copy of this module, so constructor identity is not shared:
 * a plain `instanceof` fails for an error that crosses an entry
 * boundary — e.g. a `TaskNotFoundError` from `@a2a-js/sdk/errors`
 * reaching the adapter inside `@a2a-js/sdk/server/express`.
 * `Symbol.for` resolves in the global registry, so every copy agrees
 * on this key.
 */
const A2A_ERROR_BRAND: unique symbol = Symbol.for('@a2a-js/sdk.A2AError');

/**
 * Base class for every SDK error and the concrete fallback used when
 * no semantic subclass matches (e.g. an unknown wire code). Carries
 * the spec-aligned `reason`, structured `metadata`, and a stable
 * `error.name` of `'A2AError'`. Transport subclasses in `./rest`,
 * `./grpc`, `./json_rpc` add wire context via the
 * {@link import('./rest.js').RestA2AError} / {@link import('./grpc/index.js').GrpcA2AError}
 * / {@link import('./json_rpc.js').JsonRpcA2AError} interfaces.
 *
 * Accepts either a bare message string or an options object.
 */
export class A2AError extends Error {
  /** UPPER_SNAKE_CASE reason from `google.rpc.ErrorInfo` (§10.6 / §11.6). */
  public readonly reason: string = 'INTERNAL_ERROR';
  /** Optional `google.rpc.ErrorInfo.metadata`. */
  public readonly metadata?: Record<string, string>;
  /** @see {@link A2A_ERROR_BRAND} — defined on the prototype below. */
  declare readonly [A2A_ERROR_BRAND]: true;

  /**
   * Makes `instanceof` immune to this module being duplicated across
   * entry-point bundles: the brand stands in for constructor identity.
   *
   * Inherited by every subclass, so `err instanceof TaskNotFoundError`
   * stays exact — subclasses are matched by name up the prototype
   * chain, the same identity `error.name` and the registry tables below
   * already key on. Their names come from the runtime strings in
   * `specs`, so a bundler cannot rename them; the base class, whose
   * name *is* a renameable binding, is answered by the brand alone.
   */
  static [Symbol.hasInstance](this: { name: string }, value: unknown): boolean {
    if (typeof value !== 'object' || value === null || !(A2A_ERROR_BRAND in value)) return false;
    // `Symbol.hasInstance` is looked up on the right-hand side, so `this`
    // and this closure always come from the same copy of the module.
    if ((this as unknown) === A2AError) return true;
    for (
      let proto: object | null = Object.getPrototypeOf(value);
      proto !== null;
      proto = Object.getPrototypeOf(proto)
    ) {
      if ((proto as { constructor?: { name?: string } }).constructor?.name === this.name) {
        return true;
      }
    }
    return false;
  }

  constructor(options?: A2AErrorOptions | string) {
    const opts = typeof options === 'string' ? { message: options } : options;
    super(
      opts?.message ?? 'An unexpected error occurred.',
      opts?.cause !== undefined ? { cause: opts.cause } : undefined
    );
    this.name = new.target.name;
    if (opts?.metadata && Object.keys(opts.metadata).length > 0) {
      this.metadata = opts.metadata;
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

// Non-enumerable so the brand stays out of spreads and `console.log`.
Object.defineProperty(A2AError.prototype, A2A_ERROR_BRAND, { value: true });

/**
 * Registry row for one semantic error class. Only holds the fields
 * that appear in the transport-agnostic §3.3.2 "A2A-Specific Errors"
 * table: name (also used as `error.name`), reason (ErrorInfo string),
 * and a default human-readable message. Per-transport codes/statuses
 * live in the corresponding transport files.
 */
export interface A2AErrorSpec {
  name: string;
  reason: string;
  defaultMessage: string;
}

const specs: A2AErrorSpec[] = [
  { name: 'TaskNotFoundError', reason: 'TASK_NOT_FOUND', defaultMessage: 'Task not found' },
  {
    name: 'TaskNotCancelableError',
    reason: 'TASK_NOT_CANCELABLE',
    defaultMessage: 'Task cannot be canceled',
  },
  {
    name: 'PushNotificationNotSupportedError',
    reason: 'PUSH_NOTIFICATION_NOT_SUPPORTED',
    defaultMessage: 'Push Notification is not supported',
  },
  {
    name: 'UnsupportedOperationError',
    reason: 'UNSUPPORTED_OPERATION',
    defaultMessage: 'This operation is not supported',
  },
  {
    name: 'ContentTypeNotSupportedError',
    reason: 'CONTENT_TYPE_NOT_SUPPORTED',
    defaultMessage: 'Incompatible content types',
  },
  {
    name: 'InvalidAgentResponseError',
    reason: 'INVALID_AGENT_RESPONSE',
    defaultMessage: 'Invalid agent response type',
  },
  {
    name: 'ExtendedAgentCardNotConfiguredError',
    reason: 'EXTENDED_AGENT_CARD_NOT_CONFIGURED',
    defaultMessage: 'Extended Agent Card not configured',
  },
  {
    name: 'ExtensionSupportRequiredError',
    reason: 'EXTENSION_SUPPORT_REQUIRED',
    defaultMessage: 'Extension support required',
  },
  {
    name: 'VersionNotSupportedError',
    reason: 'VERSION_NOT_SUPPORTED',
    defaultMessage: 'Version not supported',
  },
  {
    name: 'RequestMalformedError',
    reason: 'INVALID_PARAMS',
    defaultMessage: 'Request malformed',
  },
];

/** Registry lookups keyed on the identifiers used across wires. */
export const A2A_ERROR_SPECS: Readonly<Record<string, A2AErrorSpec>> = Object.freeze(
  Object.fromEntries(specs.map((s) => [s.name, s]))
);
export const A2A_ERROR_SPECS_BY_REASON: Readonly<Record<string, A2AErrorSpec>> = Object.freeze(
  Object.fromEntries(specs.map((s) => [s.reason, s]))
);

/**
 * Concrete semantic error classes. One per {@link A2AErrorSpec} row.
 * Generated by {@link makeSemantic} so adding a new row automatically
 * produces a class with the right `name`, `reason`, and default
 * message. Transport variants are declared in `./rest`, `./grpc`,
 * `./json_rpc`.
 */
function makeSemantic(spec: A2AErrorSpec): new (options?: A2AErrorOptions | string) => A2AError {
  // Named class so `error.name` and stack traces match the spec.
  const cls = {
    [spec.name]: class extends A2AError {
      public override readonly reason = spec.reason;
      constructor(options?: A2AErrorOptions | string) {
        // Apply the spec's default message when the caller didn't
        // supply one.
        if (options === undefined) super({ message: spec.defaultMessage });
        else if (typeof options === 'string') super({ message: options });
        else super({ message: spec.defaultMessage, ...options });
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
 * class name. Returns `undefined` for non-A2A errors (including the
 * concrete `A2AError` fallback which has no semantic registry entry).
 */
export function specForError(error: unknown): A2AErrorSpec | undefined {
  if (!(error instanceof Error)) return undefined;
  return A2A_ERROR_SPECS[error.name];
}

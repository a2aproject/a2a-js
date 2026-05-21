import { Extensions } from '../extensions.js';
import { User } from './authentication/user.js';

// Per the A2A spec, agents MUST interpret an absent or empty A2A-Version
// header as a v0.3 request.
const ABSENT_HEADER_VERSION = '0.3';

/**
 * Transport-agnostic representation of request headers.
 * Express passes `req.headers`; gRPC passes metadata converted to this shape.
 */
export type RequestHeaders = Record<string, string | string[] | undefined>;

/**
 * Options passed to a {@link ServerCallContextBuilder}.
 */
export interface ServerCallContextBuilderOptions {
  /** Protocol extensions parsed from the request headers. */
  extensions: Extensions | undefined;
  /** Authenticated user extracted from the request. */
  user: User | undefined;
  /** Raw request headers (transport-agnostic). */
  headers: RequestHeaders;
  /** A2A protocol version from the A2A-Version header. Absent means '0.3'. */
  requestedVersion?: string;
  /** Tenant identifier extracted from the request path or metadata. */
  tenant?: string;
}

/**
 * Factory function type for creating {@link ServerCallContext} instances.
 *
 * Provide a custom implementation to inject additional state or produce a
 * subclass of `ServerCallContext` (e.g. to mirror the Python A2A SDK's
 * `state` pattern used by operator SDKs).
 *
 * @param options - All data available at request time.
 * @returns A `ServerCallContext` (or subclass) for the current call.
 */
export type ServerCallContextBuilder = (
  options: ServerCallContextBuilderOptions
) => ServerCallContext;

/**
 * Key under which request headers are stored in {@link ServerCallContext.state}
 * by the default builder. Mirrors Python SDK's `state['headers']`.
 */
export const STATE_HEADERS_KEY = 'headers';

export interface ServerCallContextOptions {
  requestedExtensions?: Extensions;
  user?: User;
  tenant?: string;
  /**
   * The A2A protocol version requested by the client via the A2A-Version
   * service parameter. Defaults to `'0.3'` when the header is absent.
   */
  requestedVersion?: string;
  /**
   * Arbitrary key/value state bag for carrying custom data
   * (e.g. request headers, tenant IDs) through the call pipeline.
   */
  state?: Map<string, unknown>;
}

/**
 * The default {@link ServerCallContextBuilder}. Creates a `ServerCallContext`
 * with the raw request headers pre-populated in {@link ServerCallContext.state}
 * under the {@link STATE_HEADERS_KEY} key, mirroring the Python SDK's
 * `DefaultCallContextBuilder`.
 */
export const defaultServerCallContextBuilder: ServerCallContextBuilder = ({
  extensions,
  user,
  headers,
  requestedVersion,
  tenant,
}: ServerCallContextBuilderOptions): ServerCallContext => {
  const state = new Map<string, unknown>([[STATE_HEADERS_KEY, headers]]);
  return new ServerCallContext({
    requestedExtensions: extensions,
    user,
    state,
    requestedVersion,
    tenant,
  });
};

export class ServerCallContext {
  private _requestedExtensions?: Extensions;
  private readonly _user?: User;
  private readonly _requestedVersion: string;
  private readonly _tenant?: string;
  private _activatedExtensions?: Extensions;
  private readonly _state: Map<string, unknown>;

  constructor(options?: ServerCallContextOptions) {
    this._requestedExtensions = options?.requestedExtensions;
    this._user = options?.user;
    this._tenant = options?.tenant;
    this._requestedVersion = options?.requestedVersion || ABSENT_HEADER_VERSION;
    this._state = options?.state ?? new Map();
  }

  get tenant(): string | undefined {
    return this._tenant;
  }

  get user(): User | undefined {
    return this._user;
  }

  get activatedExtensions(): Extensions | undefined {
    return this._activatedExtensions;
  }

  get requestedExtensions(): Extensions | undefined {
    return this._requestedExtensions;
  }

  get requestedVersion(): string {
    return this._requestedVersion;
  }

  /**
   * Arbitrary key/value state bag, equivalent to the `state` field on the
   * Python A2A SDK's `ServerCallContext`. Use this to carry custom data
   * (e.g. request headers, tenant IDs) through the call pipeline.
   */
  get state(): Map<string, unknown> {
    return this._state;
  }

  public addActivatedExtension(uri: string) {
    this._activatedExtensions = Extensions.createFrom(this._activatedExtensions, uri);
  }

  /**
   * Replaces the requested-extensions set. Mutated in place rather than
   * via a fresh context because the transport layer holds a reference
   * to this object and reads `activatedExtensions` off it after dispatch
   * to populate the response `A2A-Extensions` header.
   */
  public setRequestedExtensions(extensions: Extensions | undefined) {
    this._requestedExtensions = extensions;
  }
}

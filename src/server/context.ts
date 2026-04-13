import { Extensions } from '../extensions.js';
import { User } from './authentication/user.js';

/**
 * Transport-agnostic representation of request headers.
 * Express passes `req.headers`; gRPC passes metadata converted to this shape.
 */
export type RequestHeaders = Record<string, string | string[] | undefined>;

/**
 * Factory function type for creating {@link ServerCallContext} instances.
 *
 * Provide a custom implementation to inject additional state or produce a
 * subclass of `ServerCallContext` (e.g. to mirror the Python A2A SDK's
 * `state` pattern used by operator SDKs).
 *
 * @param extensions - Protocol extensions parsed from the request headers.
 * @param user - Authenticated user extracted from the request.
 * @param headers - Raw request headers (transport-agnostic). Useful for
 *   populating {@link ServerCallContext.state} with metadata needed by
 *   operator SDKs (e.g. tenant ID, auth tokens).
 * @returns A `ServerCallContext` (or subclass) for the current call.
 */
export type ServerCallContextBuilder = (
  extensions: Extensions | undefined,
  user: User | undefined,
  headers: RequestHeaders
) => ServerCallContext;

/**
 * Key under which request headers are stored in {@link ServerCallContext.state}
 * by the default builder. Mirrors Python SDK's `state['headers']`.
 */
export const STATE_HEADERS_KEY = 'headers';

/**
 * The default {@link ServerCallContextBuilder}. Creates a `ServerCallContext`
 * with the raw request headers pre-populated in {@link ServerCallContext.state}
 * under the {@link STATE_HEADERS_KEY} key, mirroring the Python SDK's
 * `DefaultCallContextBuilder`.
 */
export const defaultServerCallContextBuilder: ServerCallContextBuilder = (
  extensions: Extensions | undefined,
  user: User | undefined,
  headers: RequestHeaders
): ServerCallContext => {
  const state = new Map<string, unknown>([[STATE_HEADERS_KEY, headers]]);
  return new ServerCallContext(extensions, user, state);
};

export class ServerCallContext {
  private readonly _requestedExtensions?: Extensions;
  private readonly _user?: User;
  private _activatedExtensions?: Extensions;
  private readonly _state: Map<string, unknown>;

  constructor(requestedExtensions?: Extensions, user?: User, state?: Map<string, unknown>) {
    this._requestedExtensions = requestedExtensions;
    this._user = user;
    this._state = state ?? new Map();
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
   * Returns a new `ServerCallContext` that replaces {@link requestedExtensions}
   * with the supplied value while preserving the current `user`, `state`, and
   * `activatedExtensions`. Used internally to trim extensions to the agent's
   * declared capabilities.
   */
  public withRequestedExtensions(extensions: Extensions): ServerCallContext {
    const next = new ServerCallContext(extensions, this._user, new Map(this._state));
    if (this._activatedExtensions) {
      for (const uri of this._activatedExtensions) {
        next.addActivatedExtension(uri);
      }
    }
    return next;
  }
}

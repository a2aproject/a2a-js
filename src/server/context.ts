import { Extensions } from '../extensions.js';
import { User } from './authentication/user.js';

/**
 * The A2A version assumed when the A2A-Version header is absent or empty.
 * Per §3.6.2: "Agents MUST interpret empty value as 0.3 version."
 */
const ABSENT_HEADER_VERSION = '0.3';

export interface ServerCallContextOptions {
  requestedExtensions?: Extensions;
  user?: User;
  tenant?: string;

  /**
   * The A2A protocol version requested by the client via the A2A-Version
   * service parameter. Defaults to '0.3' when the header is absent or
   * empty, per §3.6.2.
   */
  requestedVersion?: string;
}

export class ServerCallContext {
  private _requestedExtensions?: Extensions;
  private readonly _user?: User;
  private readonly _requestedVersion: string;
  private readonly _tenant?: string;
  private _activatedExtensions?: Extensions;

  constructor(options?: ServerCallContextOptions) {
    this._requestedExtensions = options?.requestedExtensions;
    this._user = options?.user;
    this._tenant = options?.tenant;
    this._requestedVersion = options?.requestedVersion || ABSENT_HEADER_VERSION;
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

  /**
   * The A2A protocol version requested by the client.
   * Defaults to '0.3' when the A2A-Version header is absent or empty (§3.6.2).
   */
  get requestedVersion(): string {
    return this._requestedVersion;
  }

  public addActivatedExtension(uri: string) {
    this._activatedExtensions = Extensions.createFrom(this._activatedExtensions, uri);
  }

  /**
   * Replaces the requested-extensions set. Used by
   * {@link DefaultRequestHandler} to narrow the list to those the agent
   * actually exposes (per §4.6.3's "SHOULD ignore" rule for unsupported
   * extensions) without orphaning the original context reference held
   * by the Express / gRPC transport layer — replacing the context would
   * strand later `addActivatedExtension(...)` calls on a dead object
   * and response-side `A2A-Extensions` header would be missing.
   */
  public setRequestedExtensions(extensions: Extensions | undefined) {
    this._requestedExtensions = extensions;
  }
}

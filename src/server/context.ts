import { Extensions } from '../extensions.js';
import { User } from './authentication/user.js';

// Per the A2A spec, agents MUST interpret an absent or empty A2A-Version
// header as a v0.3 request.
const ABSENT_HEADER_VERSION = '0.3';

export interface ServerCallContextOptions {
  requestedExtensions?: Extensions;
  user?: User;
  tenant?: string;

  /**
   * The A2A protocol version requested by the client via the A2A-Version
   * service parameter. Defaults to `'0.3'` when the header is absent.
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

  get requestedVersion(): string {
    return this._requestedVersion;
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

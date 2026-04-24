import { A2A_DEFAULT_VERSION } from '../constants.js';
import { Extensions } from '../extensions.js';
import { User } from './authentication/user.js';

export interface ServerCallContextOptions {
  requestedExtensions?: Extensions;
  user?: User;
  tenant?: string;

  /**
   * The A2A protocol version requested by the client via the A2A-Version
   * service parameter. Defaults to {@link A2A_DEFAULT_VERSION} ('0.3')
   * when the header is absent or empty, per §3.6.2.
   */
  requestedVersion?: string;
}

export class ServerCallContext {
  private readonly _requestedExtensions?: Extensions;
  private readonly _user?: User;
  private readonly _requestedVersion: string;
  private readonly _tenant?: string;
  private _activatedExtensions?: Extensions;

  constructor(options?: ServerCallContextOptions) {
    this._requestedExtensions = options?.requestedExtensions;
    this._user = options?.user;
    this._tenant = options?.tenant;
    this._requestedVersion = options?.requestedVersion || A2A_DEFAULT_VERSION;
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
}

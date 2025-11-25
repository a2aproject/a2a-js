import { User } from './authentication/user.js';

export class ServerCallContext {
  private readonly _requestedExtensions?: Set<string>;
  private readonly _user?: User;
  private _activatedExtensions?: Set<string>;

  constructor(requestedExtensions?: Set<string>, user?: User) {
    this._requestedExtensions = requestedExtensions;
    this._user = user;
  }

  get user(): User | undefined {
    return this._user;
  }

  get activatedExtensions(): ReadonlySet<string> | undefined {
    return this._activatedExtensions;
  }

  get requestedExtensions(): ReadonlySet<string> | undefined {
    return this._requestedExtensions;
  }

  public addActivatedExtension(uri: string) {
    if (this._requestedExtensions?.has(uri)) {
      if (!this._activatedExtensions) {
        this._activatedExtensions = new Set<string>();
      }
      this._activatedExtensions.add(uri);
    }
  }
}

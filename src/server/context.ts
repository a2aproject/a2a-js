import { Extensions } from '../extensions.js';
import { User } from './authentication/user.js';

export class ServerCallContext {
  private readonly _requestedExtensions?: Extensions;
  private readonly _user?: User;
  private _activatedExtensions?: Extensions;

  constructor(requestedExtensions?: Extensions, user?: User) {
    this._requestedExtensions = requestedExtensions;
    this._user = user;
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

  public addActivatedExtension(uri: string) {
    this._activatedExtensions = Extensions.createFrom(this._activatedExtensions, uri);
  }
}

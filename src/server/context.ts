import { ExtensionIds } from '../extensions.js';
import { User } from './authentication/user.js';

export class ServerCallContext {
  private readonly _requestedExtensions?: ExtensionIds;
  private readonly _user?: User;
  private _activatedExtensions?: ExtensionIds;

  constructor(requestedExtensions?: ExtensionIds, user?: User) {
    this._requestedExtensions = requestedExtensions;
    this._user = user;
  }

  get user(): User | undefined {
    return this._user;
  }

  get activatedExtensions(): ExtensionIds | undefined {
    return this._activatedExtensions;
  }

  get requestedExtensions(): ExtensionIds | undefined {
    return this._requestedExtensions;
  }

  public addActivatedExtension(uri: string) {
    this._activatedExtensions = ExtensionIds.createFrom(this._activatedExtensions, uri);
  }
}

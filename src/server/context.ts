export class ServerCallContext {
  private readonly _requestedExtensions: Set<string>;
  private readonly _activatedExtensions: Set<string>;

  constructor(
    requestedExtensions: Set<string> = new Set(),
  ) {
    this._requestedExtensions = requestedExtensions;
    this._activatedExtensions = new Set<string>();
  }

  get activatedExtensions(): ReadonlySet<string> {
    return this._activatedExtensions;
  }

  get requestedExtensions(): ReadonlySet<string> {
    return this._requestedExtensions;
  }

  public addActivatedExtension(uri: string) {
    if (this._requestedExtensions.has(uri)) {
      this._activatedExtensions.add(uri);
    }
  }

  public removeRequestedExtension(uri: string) {
    this._requestedExtensions.delete(uri);
  }
}
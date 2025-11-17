export class ServerCallContext {
  private readonly _requestedExtensions?: Set<string>;
  private _activatedExtensions?: Set<string>;

  constructor(requestedExtensions?: Set<string>) {
    this._requestedExtensions = requestedExtensions;
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

export class ServerCallContext {
  private readonly _requestedExtensions?: Set<string>;
  private readonly _activatedExtensions?: Set<string>;

  constructor(
    requestedExtensions?: Set<string>,
  ) {
    this._requestedExtensions = requestedExtensions;
    this._activatedExtensions = new Set<string>();
  }

  get activatedExtensions(): ReadonlySet<string> | undefined {
    return this._activatedExtensions;
  }

  get requestedExtensions(): ReadonlySet<string> | undefined {
    return this._requestedExtensions;
  }

  public addActivatedExtension(uri: string) {
    if (this._requestedExtensions?.has(uri)) {
      this._activatedExtensions.add(uri);
    }
  }
}
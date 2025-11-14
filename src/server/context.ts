export class ServerCallContext {
  private readonly _requestedExtensions: Set<string>;
  private readonly _activatedExtensions: Set<string>;
  private _method?: string;

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

  get method(): string | undefined {
    return this._method;
  }

  set method(value: string) {
    this._method = value;
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
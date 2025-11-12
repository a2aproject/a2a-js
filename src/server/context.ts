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

  get activatedExtensions(): Set<string> {
    return this._activatedExtensions;
  }

  get requestedExtensions(): Set<string> {
    return this._requestedExtensions;
  }

  get method(): string | undefined {
    return this._method;
  }
}
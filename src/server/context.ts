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

  set method(value: string) {
    this._method = value;
  }

  get method(): string | undefined {
    return this._method;
  }
}
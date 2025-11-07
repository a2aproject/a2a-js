export class ServerCallContext {
  public requestedExtensions?: Set<string>;
  public activatedExtensions?: Set<string>;
  public state?: Map<string, any>;


  constructor(
    requestedExtensions = new Set<string>(),
  ) {
    this.requestedExtensions = requestedExtensions;
  }
}
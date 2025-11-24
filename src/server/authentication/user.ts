export interface A2AUser {
  isAuthenticated(): boolean;
  getUser(): unknown;
}

export class UnAuthenticatedUser implements A2AUser {
  public isAuthenticated(): boolean {
    return false;
  }

  public getUser(): unknown {
    return null;
  }
}

export class ProxyUser implements A2AUser {
  private user: unknown;

  constructor(user: unknown) {
    this.user = user;
  }

  public isAuthenticated(): boolean {
    return !!this.user;
  }

  public getUser(): unknown {
    return this.user;
  }
}

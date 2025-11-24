export interface User {
  isAuthenticated(): boolean;
  getUser(): unknown;
}

export class UnAuthenticatedUser implements User {
  public isAuthenticated(): boolean {
    return false;
  }

  public getUser(): unknown {
    return null;
  }
}

export class ProxyUser implements User {
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

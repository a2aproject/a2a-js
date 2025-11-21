export interface A2AUser {
  isAuthenticated(): boolean;
  userName(): string;
}

export class UnAuthenticatedUser implements A2AUser {
  public isAuthenticated(): boolean {
    return false;
  }

  public userName(): string {
    return 'unauthenticated';
  }
}

export class ProxyUser implements A2AUser {
  private user: unknown;

  constructor(user: unknown) {
    this.user = user;
  }

  public isAuthenticated(): boolean {
    if (
      this.user instanceof Object &&
      'isAuthenticated' in this.user &&
      typeof this.user.isAuthenticated === 'function'
    ) {
      return this.user.isAuthenticated();
    }
    return false;
  }

  public userName(): string {
    if (
      this.user instanceof Object &&
      'userName' in this.user &&
      typeof this.user.userName === 'function'
    ) {
      return this.user.userName();
    }
    return 'unknown';
  }
}

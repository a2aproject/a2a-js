export interface A2AUser {
  isAuthenticated(): boolean;
  userName(): string;
}

export class UnAuthenticatedUser implements A2AUser {
  public isAuthenticated(): boolean {
    return false;
  }

  public userName(): string {
    return '';
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

  public userName(): string {
    if (this.user instanceof Object && 'userName' in this.user) {
      if (typeof this.user.userName === 'function') {
        return this.user.userName();
      }
      if (typeof this.user.userName === 'string') {
        return this.user.userName;
      }
    }
    return '';
  }
}

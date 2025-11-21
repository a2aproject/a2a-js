export interface User {
  isAuthenticated(): boolean;
}

export class AuthenticatedUser implements User {
  public isAuthenticated(): boolean {
    return true;
  }
}

export class unAuthenticatedUser implements User {
  public isAuthenticated(): boolean {
    return false;
  }
}

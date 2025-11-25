export interface User {
  isAuthenticated(): boolean;
  userName(): string;
}

export class UnauthenticatedUser implements User {
  public isAuthenticated(): boolean {
    return false;
  }

  public userName(): string {
    return '';
  }
}

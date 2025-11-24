export interface User {
  isAuthenticated(): boolean;
  userName(): string;
}

export class UnAuthenticatedUser implements User {
  public isAuthenticated(): boolean {
    return false;
  }

  public userName(): string {
    return '';
  }
}

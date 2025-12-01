export interface User {
  get isAuthenticated(): boolean;
  get userName(): string;
}

export class UnauthenticatedUser implements User {
  get isAuthenticated(): boolean {
    return false;
  }

  get userName(): string {
    return '';
  }
}

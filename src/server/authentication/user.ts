/** A user accessing the A2A server. */
export interface User {
  get isAuthenticated(): boolean;

  /** A unique identifier for the user. */
  get userName(): string;
}

/** {@link User} representing an unauthenticated caller. */
export class UnauthenticatedUser implements User {
  get isAuthenticated(): boolean {
    return false;
  }

  get userName(): string {
    return '';
  }
}

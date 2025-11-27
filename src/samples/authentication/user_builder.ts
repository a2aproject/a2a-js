import { Request } from 'express';
import { UnauthenticatedUser, User } from '../../server/index.js';
import { UserBuilder } from '../../server/express/common.js';

export class CustomUser implements User {
  constructor(
    private _userName: string,
    private _email: string,
    private _role: string
  ) {}

  public isAuthenticated(): boolean {
    return true;
  }

  public userName(): string {
    return this._userName;
  }

  public email(): string {
    return this._email;
  }

  public role(): string {
    return this._role;
  }
}

export const userBuilder: UserBuilder = async (req: Request): Promise<User> => {
  const user = req.user;
  if (user) {
    if ('userName' in user && 'email' in user && 'role' in user) {
      return new CustomUser(user.userName as string, user.email as string, user.role as string);
    }
  }
  return new UnauthenticatedUser();
};

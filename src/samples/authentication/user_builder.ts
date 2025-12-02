import { Request } from 'express';
import { UnauthenticatedUser, User } from '../../server/index.js';
import { UserBuilder } from '../../server/express/common.js';

export class CustomUser implements User {
  public isAuthenticated: boolean = true;
  constructor(
    public userName: string,
    public email: string,
    public role: string
  ) {}
}

export const userBuilder: UserBuilder = async (req: Request): Promise<User> => {
  if ('user' in req && typeof req.user === 'object') {
    const user = req.user;
    if ('userName' in user && 'email' in user && 'role' in user) {
      return new CustomUser(user.userName as string, user.email as string, user.role as string);
    }
  }
  return new UnauthenticatedUser();
};

import { Request } from 'express';
import { UnauthenticatedUser, User } from '../authentication/user.js';

export type UserBuilder = (req: Request) => Promise<User>;

export const UserBuilder = {
  noAuthentication: () => Promise.resolve(new UnauthenticatedUser()),
};

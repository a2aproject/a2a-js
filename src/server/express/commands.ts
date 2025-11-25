import { Request } from 'express';
import { User } from '../authentication/user.js';

export type UserBuilder = (req: Request) => Promise<User>;

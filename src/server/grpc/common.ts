import type * as grpc from '@grpc/grpc-js';
import { UnauthenticatedUser, User } from '../authentication/user.js';

export type UserBuilder = (
  call: grpc.ServerUnaryCall<unknown, unknown> | grpc.ServerWritableStream<unknown, unknown>
) => Promise<User>;

export const UserBuilder = {
  noAuthentication: () => Promise.resolve(new UnauthenticatedUser()),
};

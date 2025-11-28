import { Client } from './multitransport-client.js';
import { RequestOptions } from './multitransport-client.js';

export interface CallInterceptor {
  Before(options: BeforeOptions): Promise<void>;
  After(options: AfterOptions): Promise<void>;
}

export interface BeforeOptions {
  args: ClientBeforeArgs;
  options?: RequestOptions;
}

export interface AfterOptions {
  args: ClientAfterArgs;
  options?: RequestOptions;
}

export type ClientBeforeArgs = BeforeHookArgs<Client>;
export type ClientAfterArgs = AfterHookArgs<Client>;

type BeforeHookArgs<T> = {
  [K in keyof T]: T[K] extends (payload: infer P) => unknown
    ? { readonly method: K; payload: P }
    : never;
}[keyof T];

type AfterHookArgs<T> = {
  [K in keyof T]: T[K] extends (payload: unknown) => infer R
    ? { readonly method: K; result: R }
    : never;
}[keyof T];

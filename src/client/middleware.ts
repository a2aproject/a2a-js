import { A2AStreamEventData } from './client.js';
import { Client } from './multitransport-client.js';
import { RequestOptions } from './multitransport-client.js';

export interface CallInterceptor {
  before(options: BeforeArgs): Promise<void>;
  after(options: AfterArgs): Promise<void>;
}

export interface BeforeArgs {
  readonly input: ClientMethodsInputs;
  options?: RequestOptions;
}

export interface AfterArgs {
  readonly result: ClientMethodsResults;
  options?: RequestOptions;
}

export type ClientMethodsInputs = MethodsInputs<Client>;
export type ClientMethodsResults = MethodsResults<Client, ResultsOverrides>;

interface ResultsOverrides {
  // sendMessageStream and resubscribeTask returns an async iterator which is intercepted on each item,
  // which requires custom handling.
  sendMessageStream: A2AStreamEventData;
  resubscribeTask: A2AStreamEventData;
}

// Types below are helper types and are not exported to allow simplifying it without affecting
// public API if necessary. They are exported via type aliases ClientXxx which can be replaced to explicit union if necessary.

type MethodsInputs<T> = {
  [K in keyof T]: T[K] extends (payload: infer P) => unknown
    ? { readonly method: K; readonly value: P }
    : never;
}[keyof T];

type MethodsResults<T, Overrides = object> = {
  [K in keyof T]: K extends keyof Overrides // If there is an override, use it directly.
    ? { readonly method: K; result: Overrides[K] }
    : // Infer result, unwrap it from Promise and pack with method name.
      T[K] extends (payload: unknown) => infer R
      ? { readonly method: K; readonly value: Awaited<R> }
      : never;
}[keyof T];

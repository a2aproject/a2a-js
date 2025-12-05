import { A2AStreamEventData } from './client.js';
import { Client } from './multitransport-client.js';
import { RequestOptions } from './multitransport-client.js';

export interface CallInterceptor {
  /**
   * Invoked before transport method.
   */
  before(args: BeforeArgs): Promise<void>;

  /**
   * Invoked after transport method.
   */
  after(args: AfterArgs): Promise<void>;
}

export interface BeforeArgs<K extends keyof Client = keyof Client> {
  /**
   * Identifies the client method invoked and its payload.
   * Payload inside the input object can be modified.
   */
  readonly input: ClientCallInput<K>;

  /**
   * If set by the interceptor, stops execution, invokes "after"
   * for executed interceptors and returns the result. Transport is not called.
   */
  earlyReturn?: ClientCallResult<K>;

  /**
   * Options passed to the client.
   */
  options?: RequestOptions;
}

export interface AfterArgs<K extends keyof Client = keyof Client> {
  /**
   * Identifies the client method invoked and its result.
   * Payload inside the result object can be modified.
   */
  readonly result: ClientCallResult<K>;

  /**
   * If set by the interceptor, stops execution and returns result value,
   * remaining interceptors are not executed.
   */
  earlyReturn?: boolean;

  /**
   * Options passed to the client.
   */
  options?: RequestOptions;
}

export type ClientCallInput<K extends keyof Client = keyof Client> = MethodInput<Client, K>;
export type ClientCallResult<K extends keyof Client = keyof Client> = MethodResult<
  Client,
  K,
  ResultsOverrides
>;

// Types below are helper types and are not exported to allow simplifying it without affecting
// public API if necessary. They are exported via type aliases ClientXxx which can be replaced with explicit union if necessary.

/**
 * For
 *
 * interface Foo {
 *   f1(arg: string): Promise<Result1>;
 *   f2(arg: number): Promise<Result2>;
 * }
 *
 * MethodInputs<Foo> resolves to
 *
 * {
 *   readonly method: "f1";
 *   value: string;
 * } | {
 *   readonly method: "f2";
 *   value: number;
 * }
 */
type MethodInput<T, TMembers extends keyof T = keyof T> = {
  [M in TMembers]: T[M] extends (options: RequestOptions | undefined) => unknown
    ? { readonly method: M; value?: never }
    : T[M] extends (payload: infer P) => unknown
      ? { readonly method: M; value: P }
      : never;
}[TMembers];

/**
 * For
 *
 * interface Foo {
 *   f1(): Promise<Result1>;
 *   f2(): Promise<Result2>;
 * }
 *
 * MethodsResults<Foo> resolves to
 *
 * {
 *   readonly method: "f1";
 *   value: Result1;
 * } | {
 *   readonly method: "f2";
 *   value: Result2;
 * }
 */
type MethodResult<T, TMembers extends keyof T = keyof T, TOverrides = object> = {
  [M in TMembers]: M extends keyof TOverrides // If there is an override, use it directly.
    ? { readonly method: M; value: TOverrides[M] }
    : // Infer result, unwrap it from Promise and pack with method name.
      T[M] extends (payload: unknown) => infer R
      ? { readonly method: M; value: Awaited<R> }
      : never;
}[TMembers];

interface ResultsOverrides {
  // sendMessageStream and resubscribeTask return async iterators and are intercepted on each item,
  // which requires custom handling.
  sendMessageStream: A2AStreamEventData;
  resubscribeTask: A2AStreamEventData;
}

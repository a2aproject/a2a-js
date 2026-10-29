import { AgentCard, StreamResponse } from '../index.js';
import { Client, RequestOptions } from './multitransport-client.js';

export interface CallInterceptor {
  /** Invoked before the transport method. */
  before(args: BeforeArgs): Promise<void>;

  /** Invoked after the transport method. */
  after(args: AfterArgs): Promise<void>;
}

export interface BeforeArgs<K extends keyof Client = keyof Client> {
  /** The client method invoked and its payload. Payload is mutable. */
  readonly input: ClientCallInput<K>;

  /** The agent card cached on the client. */
  readonly agentCard: AgentCard;

  /**
   * If set, stops execution and returns the result. `after` runs for
   * already-executed interceptors; the transport is not called.
   */
  earlyReturn?: ClientCallResult<K>;

  /** Options passed to the client. */
  options?: RequestOptions;
}

export interface AfterArgs<K extends keyof Client = keyof Client> {
  /** The client method invoked and its result. Result value is mutable. */
  readonly result: ClientCallResult<K>;

  /** The agent card cached on the client. */
  readonly agentCard: AgentCard;

  /**
   * If set, stops execution and returns the result; remaining `after`
   * interceptors are skipped.
   */
  earlyReturn?: boolean;

  /** Options passed to the client. */
  options?: RequestOptions;
}

export type ClientCallInput<K extends keyof Client = keyof Client> = MethodInput<Client, K>;
export type ClientCallResult<K extends keyof Client = keyof Client> = MethodResult<
  Client,
  K,
  ResultsOverrides
>;

// The helper types below are not exported so they can be simplified
// without affecting the public API. They are surfaced via the
// `ClientCallInput` / `ClientCallResult` aliases above.

/**
 * For
 *
 * interface Foo {
 *   f1(arg: string): Promise<Result1>;
 *   f2(arg: number): Promise<Result2>;
 * }
 *
 * resolves to
 *
 * { readonly method: "f1"; value: string }
 * | { readonly method: "f2"; value: number }
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
 * resolves to
 *
 * { readonly method: "f1"; value: Result1 }
 * | { readonly method: "f2"; value: Result2 }
 */
type MethodResult<T, TMembers extends keyof T = keyof T, TOverrides = object> = {
  [M in TMembers]: M extends keyof TOverrides
    ? { readonly method: M; value: TOverrides[M] }
    : T[M] extends (...args: never[]) => infer R
      ? { readonly method: M; value: Awaited<R> }
      : never;
}[TMembers];

interface ResultsOverrides {
  // sendMessageStream and resubscribeTask return async iterators and are
  // intercepted per-item, which requires custom handling.
  sendMessageStream: StreamResponse;
  resubscribeTask: StreamResponse;
}

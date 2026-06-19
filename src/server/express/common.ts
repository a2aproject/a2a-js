import { Request } from 'express';
import { UnauthenticatedUser, User } from '../authentication/user.js';

export type UserBuilder = (req: Request) => Promise<User>;

export const UserBuilder = {
  noAuthentication: () => Promise.resolve(new UnauthenticatedUser()),
};

/**
 * Wraps an `AsyncIterator` in an `AsyncGenerator` that explicitly
 * propagates `.return()` back to the underlying iterator when the
 * generator is disposed (e.g. when the consuming `for await … of`
 * loop is broken out of via `break`, `throw`, or an early `return`,
 * or when the wrapping generator is itself garbage-collected).
 *
 * Replaces the naive inline wrapper
 * `{ [Symbol.asyncIterator]: () => iterator }` that the three express
 * SSE handlers used after pulling the first event eagerly to detect
 * early errors. That wrapper has no `finally` of its own and relies
 * entirely on the host engine's `for await` semantics to forward
 * `.return()` to the underlying iterator. In practice that's fragile:
 *   - Engine-dependent: works on modern V8 but varies across older
 *     engines and non-V8 runtimes (Workers, Deno).
 *   - No explicit cleanup site to instrument, log, or extend.
 *   - When the wrapped generator is passed onward (rather than consumed
 *     in-place) lifecycle boundaries can drop the `.return()` invocation
 *     entirely.
 *
 * When `.return()` is dropped, the underlying agent execution
 * generator's `finally` block never runs — leaking event-bus
 * listeners and leaving the `ExecutionEventQueue` unstopped. In
 * long-running production deployments this surfaces as unbounded
 * memory growth and eventual OOM.
 *
 * This helper's own `finally` invokes `await it.return?.()` so the
 * underlying generator's cleanup runs deterministically regardless
 * of how the consumer exits the loop, on every runtime that hosts
 * standard `async function*` semantics.
 *
 * Notably, `it.return()` is NOT called when `it.next()` itself
 * rejects: per the iterator protocol an iterator that throws from
 * `next()` is already considered closed, and calling `return()` on
 * such an iterator may either be a no-op or throw a secondary error
 * that would mask the original. This matches the host language's
 * `for await … of` semantics, which only invoke
 * `IfAbruptCloseAsyncIterator` when the loop body completes abruptly,
 * not when `IteratorStep` itself throws.
 *
 * Mirror of the client-side `readFrom` helper in `sse_utils.ts`,
 * which applies the same try/finally shape around
 * `ReadableStreamDefaultReader.releaseLock()`.
 *
 * @param it - The async iterator to delegate to (typically obtained via
 *   `stream[Symbol.asyncIterator]()` after peeking the first event).
 * @yields Values produced by the underlying iterator until it's done.
 */
export async function* delegateAsyncIterator<T>(it: AsyncIterator<T>): AsyncGenerator<T> {
  // Track whether the producer (`it.next()`) threw. If it did, the
  // iterator is already closed per the iterator protocol and calling
  // `it.return()` would either no-op or surface a secondary error that
  // masks the original. Only invoke `it.return()` for consumer-side
  // abrupt completion (`break` / `throw` / `return` inside `for await`),
  // mirroring `IfAbruptCloseAsyncIterator` in the ECMAScript spec.
  let nextThrew = false;
  try {
    while (true) {
      let result: IteratorResult<T>;
      try {
        result = await it.next();
      } catch (err) {
        nextThrew = true;
        throw err;
      }
      if (result.done) return;
      yield result.value;
    }
  } finally {
    if (!nextThrew) {
      await it.return?.();
    }
  }
}

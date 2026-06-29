import { Request } from 'express';
import { UnauthenticatedUser, User } from '../authentication/user.js';

export type UserBuilder = (req: Request) => Promise<User>;

export const UserBuilder = {
  noAuthentication: () => Promise.resolve(new UnauthenticatedUser()),
};

/**
 * Wraps an `AsyncIterator` in an `AsyncGenerator` that explicitly
 * propagates `.return()` back to the underlying iterator when the
 * generator is disposed (consumer `break`/`throw`/early `return`).
 *
 * Used by the express SSE handlers after pulling the first event
 * eagerly to detect early errors. The naive
 * `{ [Symbol.asyncIterator]: () => iterator }` wrapper has no `finally`
 * of its own and relies on the host engine's `for await` semantics to
 * forward `.return()`, which is fragile across non-V8 runtimes. When
 * `.return()` is dropped, the underlying agent execution generator's
 * `finally` block never runs, leaking event-bus listeners and leaving
 * the `ExecutionEventQueue` unstopped.
 *
 * `it.return()` is NOT called when `it.next()` itself rejects: per the
 * iterator protocol such an iterator is already closed, and calling
 * `return()` would either no-op or surface a secondary error that masks
 * the original (matching `IfAbruptCloseAsyncIterator` semantics).
 */
export async function* delegateAsyncIterator<T>(it: AsyncIterator<T>): AsyncGenerator<T> {
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

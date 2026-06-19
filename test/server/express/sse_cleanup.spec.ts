import { describe, it, expect } from 'vitest';

import { delegateAsyncIterator } from '../../../src/server/express/common.js';

/**
 * Tests for `delegateAsyncIterator` — the SSE-cleanup helper used by
 * the three express SSE response paths
 * (`server/express/rest_handler.ts`, `server/express/json_rpc_handler.ts`,
 * and `compat/v0_3/server/express/rest_handler.ts`).
 *
 * Before this fix, those three handlers wrapped a peeked iterator in
 * `{ [Symbol.asyncIterator]: () => iterator }` so they could resume
 * the `for await` loop AFTER pulling the first event eagerly. That
 * inline wrapper does not run any cleanup of its own — its lifecycle
 * is fully fused with whatever the underlying iterator does. In the
 * happy path (consumer iterates to completion) modern V8 engines DO
 * still propagate `.return()` from the outer `for await`, but the
 * pattern is fragile:
 *   - It relies on host-engine `for await` semantics (older engines and
 *     non-V8 runtimes — Workers, Deno — vary).
 *   - There is no explicit cleanup site to instrument or extend.
 *   - When the underlying iterator is "rebuilt" (peek-first then
 *     re-iterate) the engine has no view of the original generator's
 *     lifecycle and cannot guarantee `.return()` invocation on the
 *     boundary.
 *
 * `delegateAsyncIterator` replaces the inline wrapper with a real
 * `async function*` that explicitly calls `await it.return?.()` in
 * its own `finally`. This guarantees the underlying generator's
 * `finally` block (which detaches event-bus listeners and stops the
 * `ExecutionEventQueue`) runs whenever the wrapping generator is
 * disposed — by `break`, exception, GC, or natural completion.
 *
 * Mirror of the client-side `readFrom` helper in `src/sse_utils.ts:178-191`,
 * which uses the same try/finally shape around `reader.releaseLock()`.
 */
describe('delegateAsyncIterator', () => {
  it('yields every value produced by the underlying iterator in order', async () => {
    async function* source() {
      yield 1;
      yield 2;
      yield 3;
    }

    const collected: number[] = [];
    for await (const value of delegateAsyncIterator(source()[Symbol.asyncIterator]())) {
      collected.push(value);
    }
    expect(collected).toEqual([1, 2, 3]);
  });

  it('runs the underlying generator finally exactly once on natural completion', async () => {
    let finallyRan = 0;
    async function* source() {
      try {
        yield 1;
      } finally {
        finallyRan += 1;
      }
    }

    for await (const value of delegateAsyncIterator(source()[Symbol.asyncIterator]())) {
      // consume all — `value` reads suppress the unused-binding lint.
      expect(value).toBe(1);
    }
    expect(finallyRan).toBe(1);
  });

  it('propagates .return() to the underlying iterator on early break', async () => {
    // THE PRIMARY FIX BEHAVIOUR. With the new helper, breaking out of
    // the consuming `for await` loop early MUST run the underlying
    // generator's `finally` so listeners attached on the event bus
    // (and the `ExecutionEventQueue` stop hook) are released.
    let finallyRan = 0;
    async function* source() {
      try {
        yield 1;
        yield 2;
        yield 3;
      } finally {
        finallyRan += 1;
      }
    }

    for await (const value of delegateAsyncIterator(source()[Symbol.asyncIterator]())) {
      if (value === 1) break;
    }
    expect(finallyRan).toBe(1);
  });

  it('propagates .return() to the underlying iterator when consumer throws', async () => {
    let finallyRan = 0;
    async function* source() {
      try {
        yield 1;
        yield 2;
      } finally {
        finallyRan += 1;
      }
    }

    await expect(async () => {
      for await (const value of delegateAsyncIterator(source()[Symbol.asyncIterator]())) {
        // Consume the first value, then throw on the very next iteration.
        if (value === 1) throw new Error('consumer error');
      }
    }).rejects.toThrow('consumer error');
    expect(finallyRan).toBe(1);
  });

  it('explicitly calls .return() on the wrapped iterator when disposed early', async () => {
    // Pinning the contract: `delegateAsyncIterator`'s own `finally` MUST
    // invoke `.return()` on the wrapped iterator, not just hope the host
    // engine does. We verify by spying on `.return()` directly.
    let nextCalls = 0;
    let returnCalls = 0;
    const it: AsyncIterator<number> = {
      next: async () => {
        nextCalls += 1;
        return { value: nextCalls, done: false };
      },
      return: async () => {
        returnCalls += 1;
        return { value: undefined, done: true };
      },
    };

    for await (const value of delegateAsyncIterator(it)) {
      if (value >= 2) break;
    }

    expect(nextCalls).toBeGreaterThanOrEqual(2);
    expect(returnCalls).toBe(1);
  });

  it('explicitly calls .return() on the wrapped iterator on natural completion', async () => {
    // Even on natural exhaustion of the underlying iterator, the helper
    // calls `.return?.()` from its `finally`. This is the
    // "happy path" cleanup — important when the underlying iterator
    // holds external resources (file handles, locks, listener
    // subscriptions) that need explicit release.
    let returnCalls = 0;
    let index = 0;
    const values = [10, 20, 30];
    const it: AsyncIterator<number> = {
      next: async () => {
        if (index >= values.length) {
          return { value: undefined, done: true };
        }
        return { value: values[index++], done: false };
      },
      return: async () => {
        returnCalls += 1;
        return { value: undefined, done: true };
      },
    };

    const seen: number[] = [];
    for await (const value of delegateAsyncIterator(it)) {
      seen.push(value);
    }
    expect(seen).toEqual(values);
    expect(returnCalls).toBe(1);
  });

  it('handles iterators that have no .return() method gracefully (no throw)', async () => {
    // `it.return?.()` must NOT throw when the underlying iterator
    // doesn't implement `return`. Many hand-rolled `AsyncIterator`
    // objects (e.g. cursor-based DB streams) omit it.
    const values = [10, 20, 30];
    let index = 0;
    const it: AsyncIterator<number> = {
      next: async () => {
        if (index >= values.length) {
          return { value: undefined, done: true };
        }
        return { value: values[index++], done: false };
      },
      // no `return` method
    };

    const collected: number[] = [];
    for await (const value of delegateAsyncIterator(it)) {
      collected.push(value);
      if (value === 20) break;
    }
    expect(collected).toEqual([10, 20]);
  });

  it('does not double-call .return() when the iterator is naturally done', async () => {
    // If the underlying iterator signals `done: true`, the helper
    // returns from the loop and then enters its `finally` which calls
    // `.return?.()` once. That's the documented contract; we don't
    // try to suppress the `return` call after natural completion
    // because (a) it's spec-compliant (`return()` on an exhausted
    // iterator is a no-op per ES spec) and (b) iterator authors
    // already handle the case.
    let returnCalls = 0;
    let index = 0;
    const it: AsyncIterator<number> = {
      next: async () => {
        if (index >= 1) return { value: undefined, done: true };
        index += 1;
        return { value: index, done: false };
      },
      return: async () => {
        returnCalls += 1;
        return { value: undefined, done: true };
      },
    };

    let lastValue: number | undefined;
    for await (const value of delegateAsyncIterator(it)) {
      lastValue = value;
    }
    expect(lastValue).toBe(1);
    // Exactly one call from the `finally`; the wrapper does not call
    // it during the `done: true` branch.
    expect(returnCalls).toBe(1);
  });

  it('does not call .return() and propagates the original error when .next() throws', async () => {
    // Per the iterator protocol, an iterator that throws from `.next()`
    // is already considered closed and `.return()` should NOT be
    // invoked on it. Calling `.return()` in that case may either be a
    // no-op or — if `.return()` itself throws — mask the original
    // producer error. This matches ECMAScript's `for await … of`
    // semantics: `IfAbruptCloseAsyncIterator` only fires for
    // consumer-side abrupt completion, not when `IteratorStep`
    // (i.e. `.next()`) itself errors.
    let returnCalled = false;
    const it: AsyncIterator<number> = {
      next: async () => {
        throw new Error('next error');
      },
      return: async () => {
        returnCalled = true;
        // Simulate a stream whose `.return()` ALSO throws on an
        // already-errored handle (common pattern for streams that
        // were torn down by the underlying error). If the helper
        // mistakenly invokes `.return()`, this would mask the
        // 'next error' the caller actually cares about.
        throw new Error('return error');
      },
    };

    await expect(async () => {
      for await (const value of delegateAsyncIterator(it)) {
        // unreachable — the underlying `.next()` throws immediately.
        expect(value).toBeUndefined();
      }
    }).rejects.toThrow('next error');
    expect(returnCalled).toBe(false);
  });

  it('mirrors the readFrom shape from src/sse_utils.ts (client-side fix)', async () => {
    // Documents the symmetry with the client-side helper that motivated
    // this PR. `sse_utils.ts:178-191` wraps `ReadableStreamDefaultReader`
    // in a generator that runs `reader.releaseLock()` in its `finally`.
    // `delegateAsyncIterator` is the server-side equivalent for
    // `AsyncIterator<T>`, running `it.return?.()` in its `finally`.
    //
    // Both achieve the same goal: bridge a non-generator stream-like
    // object into the `async function*` lifecycle so the host engine's
    // `for await` cleanup hooks (and explicit `break`/`throw`) trigger
    // resource release deterministically.
    let cleanups = 0;
    const it: AsyncIterator<number> = {
      next: async () => ({ value: 1, done: false }),
      return: async () => {
        cleanups += 1;
        return { value: undefined, done: true };
      },
    };

    for await (const value of delegateAsyncIterator(it)) {
      expect(value).toBe(1);
      break;
    }
    expect(cleanups).toBe(1);
  });
});

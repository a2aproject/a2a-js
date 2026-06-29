import { describe, it, expect } from 'vitest';

import { delegateAsyncIterator } from '../../../src/server/express/common.js';

// delegateAsyncIterator wraps an AsyncIterator in a real async generator
// that explicitly calls `await it.return?.()` in its finally. Guarantees
// the underlying generator's cleanup runs on break/throw/GC across
// engines (V8, Workers, Deno). Mirrors the client-side readFrom in
// src/sse_utils.ts which does the same around reader.releaseLock().
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
      expect(value).toBe(1);
    }
    expect(finallyRan).toBe(1);
  });

  it('propagates .return() to the underlying iterator on early break', async () => {
    // Primary fix: early `break` must release event-bus listeners
    // attached in the underlying generator's `finally`.
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
        if (value === 1) throw new Error('consumer error');
      }
    }).rejects.toThrow('consumer error');
    expect(finallyRan).toBe(1);
  });

  it('explicitly calls .return() on the wrapped iterator when disposed early', async () => {
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
    // Happy-path cleanup still calls .return?.() so iterators holding
    // external resources (locks, listeners) release them.
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
    // Many hand-rolled AsyncIterators (cursor-based DB streams) omit .return.
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
    // Helper calls .return?.() once in its finally; .return on an
    // exhausted iterator is a spec-compliant no-op.
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
    expect(returnCalls).toBe(1);
  });

  it('does not call .return() and propagates the original error when .next() throws', async () => {
    // Per the iterator protocol an iterator that throws from .next() is
    // already closed; calling .return() can mask the original error.
    // Matches ECMAScript `for await…of` semantics.
    let returnCalled = false;
    const it: AsyncIterator<number> = {
      next: async () => {
        throw new Error('next error');
      },
      return: async () => {
        returnCalled = true;
        // .return() that also throws would mask the original error if invoked.
        throw new Error('return error');
      },
    };

    await expect(async () => {
      for await (const value of delegateAsyncIterator(it)) {
        expect(value).toBeUndefined();
      }
    }).rejects.toThrow('next error');
    expect(returnCalled).toBe(false);
  });

  it('mirrors the readFrom shape from src/sse_utils.ts (client-side fix)', async () => {
    // Server-side equivalent of the client-side readFrom helper in src/sse_utils.ts.
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

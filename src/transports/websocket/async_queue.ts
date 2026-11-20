/** A small async queue used to bridge WebSocket events and AsyncGenerators. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private ended = false;
  private terminalError: unknown;

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  end(error?: unknown): void {
    if (this.ended) return;
    this.ended = true;
    this.terminalError = error;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (error !== undefined) waiter.reject(error);
      else waiter.resolve({ value: undefined as never, done: true });
    }
  }

  get isEnded(): boolean {
    return this.ended;
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) {
      return { value: this.values.shift()!, done: false };
    }
    if (this.ended) {
      if (this.terminalError !== undefined) throw this.terminalError;
      return { value: undefined as never, done: true };
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  async return(): Promise<IteratorResult<T>> {
    this.end();
    return { value: undefined as never, done: true };
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }
}

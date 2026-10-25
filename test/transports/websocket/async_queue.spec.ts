import { describe, expect, it } from 'vitest';
import { AsyncQueue } from '../../../src/transports/websocket/async_queue.js';

describe('AsyncQueue', () => {
  it('delivers buffered values, then values pushed to waiting readers', async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    expect(await queue.next()).toEqual({ value: 1, done: false });

    const waiting = queue.next();
    queue.push(2);
    expect(await waiting).toEqual({ value: 2, done: false });
  });

  it('drains buffered values before reporting the end', async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.end();
    queue.push(2);
    queue.end(new Error('ignored after end'));
    expect(queue.isEnded).toBe(true);

    const values: number[] = [];
    for await (const value of queue) values.push(value);
    expect(values).toEqual([1]);
  });

  it('rejects waiting and later readers with the terminal error', async () => {
    const queue = new AsyncQueue<number>();
    const waiting = queue.next();
    queue.end(new Error('stream failed'));
    await expect(waiting).rejects.toThrow('stream failed');
    await expect(queue.next()).rejects.toThrow('stream failed');
  });

  it('resolves waiting readers as done when returned', async () => {
    const queue = new AsyncQueue<number>();
    const waiting = queue.next();
    expect(await queue.return()).toEqual({ value: undefined, done: true });
    expect(await waiting).toEqual({ value: undefined, done: true });
  });
});

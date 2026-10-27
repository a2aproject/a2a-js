import { describe, expect, it } from 'vitest';

import { TaskState, type Task } from '../../src/types/pb/a2a.js';
import { ServerCallContext } from '../../src/server/context.js';
import { InMemoryTaskStore } from '../../src/server/store.js';
import { isTimestampStrictlyAfter } from '../../src/server/timestamp.js';

function task(id: string, timestamp: string): Task {
  return {
    id,
    contextId: 'ctx-1',
    status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp },
    artifacts: [],
    history: [],
    metadata: undefined,
  };
}

describe('statusTimestampAfter fractions', () => {
  it('compares the fraction past the millisecond, including an offset', () => {
    expect(
      isTimestampStrictlyAfter('2026-10-02T00:00:00.000900Z', '2026-10-02T00:00:00.000500Z')
    ).toBe(true);
    expect(
      isTimestampStrictlyAfter('2026-10-02T00:00:00.000100Z', '2026-10-02T00:00:00.000500Z')
    ).toBe(false);
    expect(
      isTimestampStrictlyAfter('2026-10-02T00:00:00.000500Z', '2026-10-02T00:00:00.000500Z')
    ).toBe(false);
    expect(
      isTimestampStrictlyAfter('2026-10-02T07:00:00.000900+07:00', '2026-10-02T00:00:00.000500Z')
    ).toBe(true);
  });

  it('keeps a later fraction in the same millisecond', async () => {
    const store = new InMemoryTaskStore();
    const context = new ServerCallContext();
    await store.save(task('a-newer', '2026-10-02T00:00:00.000900Z'), context);
    await store.save(task('z-older', '2026-10-02T00:00:00.000100Z'), context);

    const response = await store.list(
      {
        tenant: '',
        contextId: '',
        status: TaskState.TASK_STATE_UNSPECIFIED,
        pageToken: '',
        pageSize: 1,
        statusTimestampAfter: '2026-10-02T00:00:00.000500Z',
      },
      context
    );

    expect(response.tasks.map((item) => item.id)).toEqual(['a-newer']);
    expect(response.totalSize).toBe(1);
  });
});

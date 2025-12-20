import { vi, type Mock } from 'vitest';
import { Task } from '../../../src/index.js';
import { TaskStore } from '../../../src/server/store.js';
import { ServerCallContext } from '../../../src/server/context.js';

export class MockTaskStore implements TaskStore {
  public save: Mock<(task: Task, ctx?: ServerCallContext) => Promise<void>> = vi.fn();
  public load: Mock<(id: string, ctx?: ServerCallContext) => Promise<Task | undefined>> = vi.fn();
}

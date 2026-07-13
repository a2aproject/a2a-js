import { describe, beforeEach, it, expect } from 'vitest';
import { MockTaskStore } from './mocks/task_store.mock.js';
import { ResultManager } from '../../src/server/index.js';
import { Message, Task, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from '../../src/index.js';

describe('ResultManager isolation', () => {
  let mockTaskStore: MockTaskStore;
  let resultManager: ResultManager;

  const taskId = 't-1';
  const contextId = 'c-1';

  beforeEach(() => {
    mockTaskStore = new MockTaskStore();
    resultManager = new ResultManager(mockTaskStore);
  });

  const createBaseTaskEvent = (overrides: Partial<Task> = {}): Task => ({
    kind: 'task',
    id: taskId,
    contextId,
    status: { state: 'submitted', timestamp: '2026-01-01T00:00:00.000Z' },
    history: [],
    artifacts: [],
    ...overrides,
  });

  it('snapshot returned by getCurrentTask() is not mutated by a later status-update', async () => {
    await resultManager.processEvent(createBaseTaskEvent());
    const snap = resultManager.getCurrentTask();
    expect(snap.status.state).toBe('submitted');

    const update: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: { state: 'working', timestamp: '2026-01-01T00:00:01.000Z' },
      final: false,
    };
    await resultManager.processEvent(update);

    expect(snap.status.state).toBe('submitted');
  });

  it('snapshot returned by getCurrentTask() is not mutated by a later artifact-update', async () => {
    await resultManager.processEvent(createBaseTaskEvent());
    const snap = resultManager.getCurrentTask();
    expect(snap.artifacts).toEqual([]);

    const update: TaskArtifactUpdateEvent = {
      kind: 'artifact-update',
      taskId,
      contextId,
      artifact: { artifactId: 'a-1', parts: [{ kind: 'text', text: 'hello' }] },
    };
    await resultManager.processEvent(update);
    expect(snap.artifacts).toEqual([]);
  });

  it('source task event arrays are not mutated by subsequent updates', async () => {
    const userMessage: Message = {
      kind: 'message',
      role: 'user',
      messageId: 'user-m-1',
      parts: [{ kind: 'text', text: 'hi' }],
    };
    resultManager.setContext(userMessage);

    const history: Message[] = [];
    const artifacts: Task['artifacts'] = [];
    const taskEvent = createBaseTaskEvent({ history, artifacts });
    await resultManager.processEvent(taskEvent);

    const statusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state: 'working',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          kind: 'message',
          role: 'agent',
          messageId: 'agent-m-1',
          parts: [{ kind: 'text', text: 'working' }],
        },
      },
      final: false,
    };
    await resultManager.processEvent(statusUpdate);

    const artifactUpdate: TaskArtifactUpdateEvent = {
      kind: 'artifact-update',
      taskId,
      contextId,
      artifact: { artifactId: 'a-1', parts: [{ kind: 'text', text: 'out' }] },
    };
    await resultManager.processEvent(artifactUpdate);

    expect(history).toEqual([]);
    expect(artifacts).toEqual([]);
    expect(taskEvent.status.state).toBe('submitted');
  });
});

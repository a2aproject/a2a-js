import { describe, expect, it } from 'vitest';
import {
  toCoreTask,
  toCoreTaskArtifactUpdateEvent,
  toCoreTaskStatusUpdateEvent,
  type legacy,
} from '../../../src/compat/v0_3/translate/index.js';
import { Role, TaskState } from '../../../src/index.js';

// A receiver that is not an SDK client gets a raw v0.3 body on its own webhook
// route and has to lift it to v1.0 before handing it to a v1.0 pipeline. That
// is the path issue #646 describes, so these tests go through the published
// entry point rather than the translate module directly.

describe('compat/v0_3 public entry point', () => {
  it('lifts a v0.3 task push body to v1.0', () => {
    const body: legacy.Task = {
      kind: 'task',
      id: 'task-1',
      contextId: 'ctx-1',
      status: {
        state: 'completed',
        timestamp: '2026-08-20T10:00:00.000Z',
        message: {
          kind: 'message',
          messageId: 'msg-1',
          role: 'agent',
          parts: [{ kind: 'text', text: 'done' }],
        },
      },
    };

    const task = toCoreTask(body);

    expect(task.id).toBe('task-1');
    expect(task.contextId).toBe('ctx-1');
    expect(task.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(task.status?.message?.role).toBe(Role.ROLE_AGENT);
    expect(task.status?.message?.parts[0].content).toEqual({
      $case: 'text',
      value: 'done',
    });
  });

  it('lifts a v0.3 status-update push body to v1.0 and drops final', () => {
    const body: legacy.TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: 'task-1',
      contextId: 'ctx-1',
      status: { state: 'working' },
      final: false,
    };

    const event = toCoreTaskStatusUpdateEvent(body);

    expect(event.taskId).toBe('task-1');
    expect(event.status?.state).toBe(TaskState.TASK_STATE_WORKING);
    expect(event).not.toHaveProperty('final');
  });

  it('lifts a v0.3 artifact-update push body to v1.0', () => {
    const body: legacy.TaskArtifactUpdateEvent = {
      kind: 'artifact-update',
      taskId: 'task-1',
      contextId: 'ctx-1',
      artifact: {
        artifactId: 'art-1',
        parts: [{ kind: 'text', text: 'chunk' }],
      },
      append: true,
      lastChunk: false,
    };

    const event = toCoreTaskArtifactUpdateEvent(body);

    expect(event.artifact?.artifactId).toBe('art-1');
    expect(event.append).toBe(true);
    expect(event.lastChunk).toBe(false);
  });
});

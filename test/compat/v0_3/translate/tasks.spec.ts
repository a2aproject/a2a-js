import { describe, expect, it } from 'vitest';
import {
  toCompatTask,
  toCompatTaskArtifactUpdateEvent,
  toCompatTaskStatus,
  toCompatTaskStatusUpdateEvent,
  toCoreTask,
  toCoreTaskArtifactUpdateEvent,
  toCoreTaskStatus,
  toCoreTaskStatusUpdateEvent,
} from '../../../../src/compat/v0_3/translate/tasks.js';
import { Role, TaskState } from '../../../../src/types/pb/a2a.js';
import type {
  Task as V1Task,
  TaskArtifactUpdateEvent as V1TaskArtifactUpdateEvent,
  TaskStatus as V1TaskStatus,
  TaskStatusUpdateEvent as V1TaskStatusUpdateEvent,
} from '../../../../src/types/pb/a2a.js';
import type * as legacy from '../../../../src/compat/v0_3/types/types.js';

describe('tasks', () => {
  describe('TaskStatus', () => {
    it('round-trips a basic status', () => {
      const compat: legacy.TaskStatus = { state: 'working', timestamp: '2024-01-01T00:00:00Z' };
      expect(toCompatTaskStatus(toCoreTaskStatus(compat))).toEqual(compat);
    });

    it('round-trips a status with a message', () => {
      const compat: legacy.TaskStatus = {
        state: 'completed',
        message: {
          kind: 'message',
          messageId: 'm1',
          role: 'agent',
          parts: [{ kind: 'text', text: 'done' }],
        },
      };
      expect(toCompatTaskStatus(toCoreTaskStatus(compat))).toEqual(compat);
    });

    it('drops empty timestamp going to compat', () => {
      const core: V1TaskStatus = {
        state: TaskState.TASK_STATE_WORKING,
        message: undefined,
        timestamp: '',
      };
      expect(toCompatTaskStatus(core)).toEqual({ state: 'working' });
    });
  });

  describe('Task', () => {
    it('round-trips a fully-populated task', () => {
      const compat: legacy.Task = {
        kind: 'task',
        id: 't1',
        contextId: 'ctx',
        status: { state: 'submitted' },
        artifacts: [{ artifactId: 'a1', parts: [{ kind: 'text', text: 'x' }] }],
        history: [
          {
            kind: 'message',
            messageId: 'm1',
            role: 'user',
            parts: [{ kind: 'text', text: 'hi' }],
          },
        ],
        metadata: { k: 'v' },
      };
      expect(toCompatTask(toCoreTask(compat))).toEqual(compat);
    });

    it('replaces a missing status with an unknown placeholder', () => {
      const core: V1Task = {
        id: 't1',
        contextId: 'ctx',
        status: undefined,
        artifacts: [],
        history: [],
        metadata: undefined,
      };
      expect(toCompatTask(core).status).toEqual({ state: 'unknown' });
    });

    it('prunes empty arrays going to compat', () => {
      const core: V1Task = {
        id: 't1',
        contextId: 'ctx',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: '' },
        artifacts: [],
        history: [],
        metadata: undefined,
      };
      const compat = toCompatTask(core);
      expect(compat.artifacts).toBeUndefined();
      expect(compat.history).toBeUndefined();
      expect(compat.metadata).toBeUndefined();
    });

    it('coerces missing arrays to empty going to core', () => {
      const compat: legacy.Task = {
        kind: 'task',
        id: 't1',
        contextId: 'ctx',
        status: { state: 'working' },
      };
      const core = toCoreTask(compat);
      expect(core.artifacts).toEqual([]);
      expect(core.history).toEqual([]);
    });
  });

  describe('TaskStatusUpdateEvent', () => {
    it('drops `final` going to core', () => {
      const compat: legacy.TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 't1',
        contextId: 'ctx',
        status: { state: 'completed' },
        final: true,
      };
      const core = toCoreTaskStatusUpdateEvent(compat);
      // v1.0 has no `final` field; presence-check is structural.
      expect('final' in core).toBe(false);
      expect(core.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    });

    it.each<[legacy.TaskStatus['state'], boolean]>([
      ['completed', true],
      ['canceled', true],
      ['failed', true],
      ['rejected', true],
      ['working', false],
      ['submitted', false],
      ['input-required', false],
      ['auth-required', false],
      ['unknown', false],
    ])('computes final=%s for state=%s going to compat', (state, expected) => {
      const core: V1TaskStatusUpdateEvent = {
        taskId: 't1',
        contextId: 'ctx',
        status: { state: TaskState.TASK_STATE_UNSPECIFIED, message: undefined, timestamp: '' },
        metadata: undefined,
      };
      // Reuse the table-driven test by translating the literal back into a core enum.
      const enumValue = (
        {
          completed: TaskState.TASK_STATE_COMPLETED,
          canceled: TaskState.TASK_STATE_CANCELED,
          failed: TaskState.TASK_STATE_FAILED,
          rejected: TaskState.TASK_STATE_REJECTED,
          working: TaskState.TASK_STATE_WORKING,
          submitted: TaskState.TASK_STATE_SUBMITTED,
          'input-required': TaskState.TASK_STATE_INPUT_REQUIRED,
          'auth-required': TaskState.TASK_STATE_AUTH_REQUIRED,
          unknown: TaskState.TASK_STATE_UNSPECIFIED,
        } satisfies Record<legacy.TaskStatus['state'], TaskState>
      )[state];
      core.status = { state: enumValue, message: undefined, timestamp: '' };
      expect(toCompatTaskStatusUpdateEvent(core).final).toBe(expected);
    });

    it('sets the legacy discriminator kind to "status-update"', () => {
      const core: V1TaskStatusUpdateEvent = {
        taskId: 't1',
        contextId: 'ctx',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: '' },
        metadata: undefined,
      };
      expect(toCompatTaskStatusUpdateEvent(core).kind).toBe('status-update');
    });
  });

  describe('TaskArtifactUpdateEvent', () => {
    it('defaults missing booleans to false going to core', () => {
      const compat: legacy.TaskArtifactUpdateEvent = {
        kind: 'artifact-update',
        taskId: 't1',
        contextId: 'ctx',
        artifact: { artifactId: 'a1', parts: [] },
      };
      const core = toCoreTaskArtifactUpdateEvent(compat);
      expect(core.append).toBe(false);
      expect(core.lastChunk).toBe(false);
    });

    it('preserves explicit booleans going to compat', () => {
      const core: V1TaskArtifactUpdateEvent = {
        taskId: 't1',
        contextId: 'ctx',
        artifact: {
          artifactId: 'a1',
          name: '',
          description: '',
          parts: [],
          metadata: undefined,
          extensions: [],
        },
        append: true,
        lastChunk: false,
        metadata: undefined,
      };
      const compat = toCompatTaskArtifactUpdateEvent(core);
      expect(compat.kind).toBe('artifact-update');
      expect(compat.append).toBe(true);
      expect(compat.lastChunk).toBe(false);
    });

    it('throws when the artifact is missing', () => {
      const core: V1TaskArtifactUpdateEvent = {
        taskId: 't1',
        contextId: 'ctx',
        artifact: undefined,
        append: false,
        lastChunk: false,
        metadata: undefined,
      };
      expect(() => toCompatTaskArtifactUpdateEvent(core)).toThrow();
    });

    it('uses the right discriminator kind', () => {
      const compat: legacy.TaskArtifactUpdateEvent = {
        kind: 'artifact-update',
        taskId: 't1',
        contextId: 'ctx',
        artifact: { artifactId: 'a1', parts: [] },
      };
      const core = toCoreTaskArtifactUpdateEvent(compat);
      expect(toCompatTaskArtifactUpdateEvent(core).kind).toBe('artifact-update');
    });
  });

  describe('round-tripping', () => {
    it('round-trips a message inside a task', () => {
      const compat: legacy.Task = {
        kind: 'task',
        id: 't1',
        contextId: 'ctx',
        status: {
          state: 'working',
          message: {
            kind: 'message',
            messageId: 'm1',
            role: Role.ROLE_USER === 1 ? 'user' : 'agent',
            parts: [{ kind: 'text', text: 'x' }],
          },
        },
      };
      expect(toCompatTask(toCoreTask(compat))).toEqual(compat);
    });
  });
});

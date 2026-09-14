import { describe, expect, it } from 'vitest';
import { convertLegacyPushBody } from '../../../src/compat/v0_3/convert_legacy_push_body.js';
import { TaskState } from '../../../src/types/pb/a2a.js';

describe('convertLegacyPushBody', () => {
  describe('kind="task"', () => {
    it('returns a V1Task', () => {
      const body = {
        kind: 'task',
        id: 't-1',
        contextId: 'ctx-1',
        status: { state: 'completed', timestamp: '2026-01-01T00:00:00Z' },
      };
      const result = convertLegacyPushBody(body);
      expect(result).toMatchObject({
        id: 't-1',
        contextId: 'ctx-1',
        status: { state: TaskState.TASK_STATE_COMPLETED },
      });
      expect(result).not.toHaveProperty('kind');
    });
  });

  describe('kind="message"', () => {
    it('returns a V1Message', () => {
      const body = {
        kind: 'message',
        messageId: 'm-1',
        role: 'agent',
        parts: [{ kind: 'text', text: 'hello' }],
      };
      const result = convertLegacyPushBody(body) as { messageId: string };
      expect(result.messageId).toBe('m-1');
      expect(result).not.toHaveProperty('kind');
    });
  });

  describe('kind="status-update"', () => {
    it('returns a V1TaskStatusUpdateEvent', () => {
      const body = {
        kind: 'status-update',
        taskId: 't-2',
        contextId: 'ctx-2',
        status: { state: 'working', timestamp: '2026-01-01T00:00:00Z' },
        final: false,
      };
      const result = convertLegacyPushBody(body) as {
        taskId: string;
        status: { state: number };
      };
      expect(result.taskId).toBe('t-2');
      expect(result.status.state).toBe(TaskState.TASK_STATE_WORKING);
      expect(result).not.toHaveProperty('kind');
      expect(result).not.toHaveProperty('final');
    });
  });

  describe('kind="artifact-update"', () => {
    it('returns a V1TaskArtifactUpdateEvent', () => {
      const body = {
        kind: 'artifact-update',
        taskId: 't-3',
        contextId: 'ctx-3',
        artifact: {
          artifactId: 'art-1',
          name: 'out.txt',
          parts: [{ kind: 'text', text: 'data' }],
        },
        append: false,
        lastChunk: true,
      };
      const result = convertLegacyPushBody(body) as {
        taskId: string;
        artifact: { artifactId: string };
      };
      expect(result.taskId).toBe('t-3');
      expect(result.artifact.artifactId).toBe('art-1');
      expect(result).not.toHaveProperty('kind');
    });
  });

  describe('error cases', () => {
    it('throws for null', () => {
      expect(() => convertLegacyPushBody(null)).toThrow(/kind/);
    });

    it('throws for a non-object', () => {
      expect(() => convertLegacyPushBody('task')).toThrow(/kind/);
    });

    it('throws when kind field is missing', () => {
      expect(() => convertLegacyPushBody({ id: 't-1' })).toThrow(/kind/);
    });

    it('throws for an unknown kind', () => {
      expect(() => convertLegacyPushBody({ kind: 'unknown-event' })).toThrow(
        /Unknown v0\.3 push body kind: unknown-event/
      );
    });
  });
});

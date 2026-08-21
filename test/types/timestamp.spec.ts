import { describe, it, expect } from 'vitest';
import { TaskStatus, ListTasksRequest } from '../../src/types/pb/a2a.js';

describe('google.protobuf.Timestamp protobuf codec (Issue #641)', () => {
  describe('TaskStatus.timestamp', () => {
    it('leaves an already-normalized UTC timestamp alone', () => {
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
        timestamp: '2026-01-01T00:00:00Z',
      };
      const parsed = TaskStatus.fromJSON(input);
      expect(parsed.timestamp).toBe('2026-01-01T00:00:00Z');

      const serialized = TaskStatus.toJSON(parsed) as Record<string, unknown>;
      expect(serialized.timestamp).toBe('2026-01-01T00:00:00Z');
    });

    it('normalizes positive non-UTC timezone offsets to UTC (Z)', () => {
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
        timestamp: '2026-01-01T05:30:00+05:30',
      };
      const parsed = TaskStatus.fromJSON(input);
      expect(parsed.timestamp).toBe('2026-01-01T00:00:00Z');

      const serialized = TaskStatus.toJSON(parsed) as Record<string, unknown>;
      expect(serialized.timestamp).toBe('2026-01-01T00:00:00Z');
    });

    it('normalizes negative non-UTC timezone offsets to UTC (Z)', () => {
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
        timestamp: '2025-12-31T19:00:00-05:00',
      };
      const parsed = TaskStatus.fromJSON(input);
      expect(parsed.timestamp).toBe('2026-01-01T00:00:00Z');

      const serialized = TaskStatus.toJSON(parsed) as Record<string, unknown>;
      expect(serialized.timestamp).toBe('2026-01-01T00:00:00Z');
    });

    it('preserves subsecond precision when present', () => {
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
        timestamp: '2026-01-01T00:00:00.123Z',
      };
      const parsed = TaskStatus.fromJSON(input);
      expect(parsed.timestamp).toBe('2026-01-01T00:00:00.123Z');
    });

    it('supports Date instances', () => {
      const date = new Date('2026-01-01T00:00:00Z');
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
        timestamp: date,
      };
      const parsed = TaskStatus.fromJSON(input);
      expect(parsed.timestamp).toBe(date.toISOString());
    });

    it('rejects unparseable string with an Error', () => {
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
        timestamp: 'not-a-timestamp',
      };
      expect(() => TaskStatus.fromJSON(input)).toThrow(/Value is not a valid timestamp/);
    });

    it('rejects empty string with an Error', () => {
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
        timestamp: '',
      };
      expect(() => TaskStatus.fromJSON(input)).toThrow(/Value is not a valid timestamp/);
    });

    it('rejects numbers with an Error', () => {
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
        timestamp: 12345,
      };
      expect(() => TaskStatus.fromJSON(input)).toThrow(/Value is not a valid timestamp/);
    });

    it('rejects boolean values with an Error', () => {
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
        timestamp: true,
      };
      expect(() => TaskStatus.fromJSON(input)).toThrow(/Value is not a valid timestamp/);
    });

    it('rejects object values with an Error', () => {
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
        timestamp: { invalid: 'object' },
      };
      expect(() => TaskStatus.fromJSON(input)).toThrow(/Value is not a valid timestamp/);
    });

    it('leaves timestamp undefined when omitted', () => {
      const input: Record<string, unknown> = {
        state: 'TASK_STATE_WORKING',
      };
      const parsed = TaskStatus.fromJSON(input);
      expect(parsed.timestamp).toBeUndefined();

      const serialized = TaskStatus.toJSON(parsed) as Record<string, unknown>;
      expect(serialized).not.toHaveProperty('timestamp');
    });
  });

  describe('ListTasksRequest.statusTimestampAfter', () => {
    it('normalizes statusTimestampAfter', () => {
      const input: Record<string, unknown> = {
        statusTimestampAfter: '2026-01-01T05:30:00+05:30',
      };
      const parsed = ListTasksRequest.fromJSON(input);
      expect(parsed.statusTimestampAfter).toBe('2026-01-01T00:00:00Z');
    });

    it('normalizes status_timestamp_after snake_case', () => {
      const input: Record<string, unknown> = {
        status_timestamp_after: '2026-01-01T05:30:00+05:30',
      };
      const parsed = ListTasksRequest.fromJSON(input);
      expect(parsed.statusTimestampAfter).toBe('2026-01-01T00:00:00Z');
    });

    it('rejects invalid statusTimestampAfter', () => {
      const input: Record<string, unknown> = {
        statusTimestampAfter: 'invalid-date',
      };
      expect(() => ListTasksRequest.fromJSON(input)).toThrow(/Value is not a valid timestamp/);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  TaskStatus,
  Message,
  TaskState,
  Role,
  taskStateFromJSON,
  taskStateToJSON,
  roleFromJSON,
  roleToJSON,
} from '../../src/types/pb/a2a.js';

describe('Enum codecs and proto3 conformance (Issue #640)', () => {
  describe('TaskState', () => {
    it('accepts a known value by name and round-trips as name string', () => {
      const parsed = taskStateFromJSON('TASK_STATE_WORKING');
      expect(parsed).toBe(TaskState.TASK_STATE_WORKING);

      const serialized = taskStateToJSON(parsed);
      expect(serialized).toBe('TASK_STATE_WORKING');
    });

    it('accepts a known value by number and round-trips as name string', () => {
      const parsed = taskStateFromJSON(2);
      expect(parsed).toBe(TaskState.TASK_STATE_WORKING);

      const serialized = taskStateToJSON(parsed);
      expect(serialized).toBe('TASK_STATE_WORKING');
    });

    it('preserves an unknown enum numeric value as its integer', () => {
      const parsed = taskStateFromJSON(99);
      expect(parsed).toBe(99 as TaskState);

      const serialized = taskStateToJSON(parsed);
      expect(serialized).toBe(99);
    });

    it('maps UNRECOGNIZED string to sentinel', () => {
      const parsed = taskStateFromJSON('UNRECOGNIZED');
      expect(parsed).toBe(TaskState.UNRECOGNIZED);

      const serialized = taskStateToJSON(parsed);
      expect(serialized).toBe('UNRECOGNIZED');
    });

    it('round-trips unknown state inside TaskStatus message', () => {
      const input: Record<string, unknown> = { state: 99 };
      const parsed = TaskStatus.fromJSON(input);
      expect(parsed.state).toBe(99 as TaskState);

      const output = TaskStatus.toJSON(parsed) as Record<string, unknown>;
      expect(output.state).toBe(99);
    });
  });

  describe('Role', () => {
    it('accepts a known role by name and round-trips as name string', () => {
      const parsed = roleFromJSON('ROLE_USER');
      expect(parsed).toBe(Role.ROLE_USER);

      const serialized = roleToJSON(parsed);
      expect(serialized).toBe('ROLE_USER');
    });

    it('accepts a known role by number and round-trips as name string', () => {
      const parsed = roleFromJSON(1);
      expect(parsed).toBe(Role.ROLE_USER);

      const serialized = roleToJSON(parsed);
      expect(serialized).toBe('ROLE_USER');
    });

    it('preserves an unknown role numeric value as its integer', () => {
      const parsed = roleFromJSON(42);
      expect(parsed).toBe(42 as Role);

      const serialized = roleToJSON(parsed);
      expect(serialized).toBe(42);
    });

    it('maps UNRECOGNIZED string to sentinel', () => {
      const parsed = roleFromJSON('UNRECOGNIZED');
      expect(parsed).toBe(Role.UNRECOGNIZED);

      const serialized = roleToJSON(parsed);
      expect(serialized).toBe('UNRECOGNIZED');
    });

    it('round-trips unknown role inside Message object', () => {
      const input: Record<string, unknown> = { role: 42 };
      const parsed = Message.fromJSON(input);
      expect(parsed.role).toBe(42 as Role);

      const output = Message.toJSON(parsed) as Record<string, unknown>;
      expect(output.role).toBe(42);
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  toCoreRole,
  toCoreTaskState,
  toCompatRole,
  toCompatTaskState,
} from '../../../../src/compat/v0_3/translate/enums.js';
import { Role, TaskState } from '../../../../src/types/pb/a2a.js';
import type { TaskStatus } from '../../../../src/compat/v0_3/types/types.js';

type LegacyTaskState = TaskStatus['state'];

const ALL_LEGACY_STATES: LegacyTaskState[] = [
  'unknown',
  'submitted',
  'working',
  'completed',
  'failed',
  'canceled',
  'input-required',
  'rejected',
  'auth-required',
];

const TASK_STATE_COMPAT_TO_CORE: Record<LegacyTaskState, TaskState> = {
  unknown: 0,
  submitted: 1,
  working: 2,
  completed: 3,
  failed: 4,
  canceled: 5,
  'input-required': 6,
  rejected: 7,
  'auth-required': 8,
};

const TASK_STATE_CORE_TO_COMPAT: ReadonlyMap<TaskState, LegacyTaskState> = new Map(
  (Object.entries(TASK_STATE_COMPAT_TO_CORE) as [LegacyTaskState, TaskState][]).map(
    ([literal, enumValue]) => [enumValue, literal]
  )
);

describe('enums', () => {
  describe('TASK_STATE_COMPAT_TO_CORE', () => {
    it('contains an entry for every legacy literal', () => {
      for (const literal of ALL_LEGACY_STATES) {
        expect(TASK_STATE_COMPAT_TO_CORE[literal]).toBeDefined();
      }
    });

    it('maps "canceled" to TASK_STATE_CANCELED (one L, v1.0 spelling)', () => {
      expect(TASK_STATE_COMPAT_TO_CORE.canceled).toBe(TaskState.TASK_STATE_CANCELED);
    });

    it('maps "unknown" to TASK_STATE_UNSPECIFIED', () => {
      expect(TASK_STATE_COMPAT_TO_CORE.unknown).toBe(TaskState.TASK_STATE_UNSPECIFIED);
    });
  });

  describe('TASK_STATE_CORE_TO_COMPAT', () => {
    it('round-trips every legacy literal back to itself', () => {
      for (const literal of ALL_LEGACY_STATES) {
        const enumValue = TASK_STATE_COMPAT_TO_CORE[literal];
        expect(TASK_STATE_CORE_TO_COMPAT.get(enumValue)).toBe(literal);
      }
    });
  });

  describe('toCoreTaskState', () => {
    it.each(ALL_LEGACY_STATES)('maps %s correctly', (literal) => {
      expect(toCoreTaskState(literal)).toBe(TASK_STATE_COMPAT_TO_CORE[literal]);
    });
  });

  describe('toCompatTaskState', () => {
    it.each(ALL_LEGACY_STATES)('round-trips %s', (literal) => {
      expect(toCompatTaskState(TASK_STATE_COMPAT_TO_CORE[literal])).toBe(literal);
    });

    it('falls back to "unknown" for UNRECOGNIZED', () => {
      expect(toCompatTaskState(TaskState.UNRECOGNIZED)).toBe('unknown');
    });

    it('falls back to "unknown" for an out-of-range enum value', () => {
      expect(toCompatTaskState(999 as TaskState)).toBe('unknown');
    });
  });

  describe('toCoreRole', () => {
    it('maps "user" to ROLE_USER', () => {
      expect(toCoreRole('user')).toBe(Role.ROLE_USER);
    });

    it('maps "agent" to ROLE_AGENT', () => {
      expect(toCoreRole('agent')).toBe(Role.ROLE_AGENT);
    });
  });

  describe('toCompatRole', () => {
    it('maps ROLE_USER to "user"', () => {
      expect(toCompatRole(Role.ROLE_USER)).toBe('user');
    });

    it('maps ROLE_AGENT to "agent"', () => {
      expect(toCompatRole(Role.ROLE_AGENT)).toBe('agent');
    });

    it('falls back to "agent" for ROLE_UNSPECIFIED', () => {
      expect(toCompatRole(Role.ROLE_UNSPECIFIED)).toBe('agent');
    });

    it('falls back to "agent" for UNRECOGNIZED', () => {
      expect(toCompatRole(Role.UNRECOGNIZED)).toBe('agent');
    });
  });
});

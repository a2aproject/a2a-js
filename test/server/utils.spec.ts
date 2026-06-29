import { describe, it, expect } from 'vitest';

import { TaskState } from '../../src/types/pb/a2a.js';
import {
  AUTH_REQUIRED_STATE_LIST,
  INPUT_REQUIRED_STATE_LIST,
  INTERRUPTED_STATE_LIST,
  TERMINAL_STATE_LIST,
} from '../../src/server/utils.js';

describe('utils interrupted-state lists', () => {
  describe('INPUT_REQUIRED_STATE_LIST', () => {
    it('contains exactly TASK_STATE_INPUT_REQUIRED', () => {
      expect(INPUT_REQUIRED_STATE_LIST).toEqual([TaskState.TASK_STATE_INPUT_REQUIRED]);
    });

    it('does not contain TASK_STATE_AUTH_REQUIRED', () => {
      expect(INPUT_REQUIRED_STATE_LIST).not.toContain(TaskState.TASK_STATE_AUTH_REQUIRED);
    });

    it('does not contain any terminal state', () => {
      for (const terminal of TERMINAL_STATE_LIST) {
        expect(INPUT_REQUIRED_STATE_LIST).not.toContain(terminal);
      }
    });
  });

  describe('AUTH_REQUIRED_STATE_LIST', () => {
    it('contains exactly TASK_STATE_AUTH_REQUIRED', () => {
      expect(AUTH_REQUIRED_STATE_LIST).toEqual([TaskState.TASK_STATE_AUTH_REQUIRED]);
    });

    it('does not contain TASK_STATE_INPUT_REQUIRED', () => {
      expect(AUTH_REQUIRED_STATE_LIST).not.toContain(TaskState.TASK_STATE_INPUT_REQUIRED);
    });

    it('does not contain any terminal state', () => {
      for (const terminal of TERMINAL_STATE_LIST) {
        expect(AUTH_REQUIRED_STATE_LIST).not.toContain(terminal);
      }
    });
  });

  describe('INTERRUPTED_STATE_LIST', () => {
    it('is the union of INPUT_REQUIRED_STATE_LIST and AUTH_REQUIRED_STATE_LIST', () => {
      expect(new Set(INTERRUPTED_STATE_LIST)).toEqual(
        new Set([...INPUT_REQUIRED_STATE_LIST, ...AUTH_REQUIRED_STATE_LIST])
      );
    });

    it('contains both TASK_STATE_INPUT_REQUIRED and TASK_STATE_AUTH_REQUIRED', () => {
      expect(INTERRUPTED_STATE_LIST).toContain(TaskState.TASK_STATE_INPUT_REQUIRED);
      expect(INTERRUPTED_STATE_LIST).toContain(TaskState.TASK_STATE_AUTH_REQUIRED);
    });

    it('has length equal to sum of component lists (no overlap)', () => {
      expect(INTERRUPTED_STATE_LIST).toHaveLength(
        INPUT_REQUIRED_STATE_LIST.length + AUTH_REQUIRED_STATE_LIST.length
      );
    });

    it('does not contain any terminal state', () => {
      for (const terminal of TERMINAL_STATE_LIST) {
        expect(INTERRUPTED_STATE_LIST).not.toContain(terminal);
      }
    });

    it('INPUT_REQUIRED_STATE_LIST and AUTH_REQUIRED_STATE_LIST are disjoint', () => {
      const inputSet = new Set(INPUT_REQUIRED_STATE_LIST);
      for (const state of AUTH_REQUIRED_STATE_LIST) {
        expect(inputSet.has(state)).toBe(false);
      }
    });
  });
});

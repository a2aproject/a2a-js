// Enum translators for v1.0 ↔ v0.3.

import { Role as V1Role, TaskState as V1TaskState } from '../../../types/pb/a2a.js';
import type { TaskStatus as LegacyTaskStatus } from '../types/types.js';

type LegacyTaskState = LegacyTaskStatus['state'];

const TASK_STATE_COMPAT_TO_CORE: Readonly<Record<LegacyTaskState, V1TaskState>> = Object.freeze({
  unknown: V1TaskState.TASK_STATE_UNSPECIFIED,
  submitted: V1TaskState.TASK_STATE_SUBMITTED,
  working: V1TaskState.TASK_STATE_WORKING,
  completed: V1TaskState.TASK_STATE_COMPLETED,
  failed: V1TaskState.TASK_STATE_FAILED,
  canceled: V1TaskState.TASK_STATE_CANCELED,
  'input-required': V1TaskState.TASK_STATE_INPUT_REQUIRED,
  rejected: V1TaskState.TASK_STATE_REJECTED,
  'auth-required': V1TaskState.TASK_STATE_AUTH_REQUIRED,
});

const TASK_STATE_CORE_TO_COMPAT: ReadonlyMap<V1TaskState, LegacyTaskState> = new Map(
  (Object.entries(TASK_STATE_COMPAT_TO_CORE) as [LegacyTaskState, V1TaskState][]).map(
    ([literal, enumValue]) => [enumValue, literal]
  )
);

/** Unknown literals fall back to `TASK_STATE_UNSPECIFIED` (defensive). */
export function toCoreTaskState(state: LegacyTaskState): V1TaskState {
  return TASK_STATE_COMPAT_TO_CORE[state] ?? V1TaskState.TASK_STATE_UNSPECIFIED;
}

/** Unmapped values (incl. `UNRECOGNIZED`) become `'unknown'`. */
export function toCompatTaskState(state: V1TaskState): LegacyTaskState {
  return TASK_STATE_CORE_TO_COMPAT.get(state) ?? 'unknown';
}

/** Unknown roles resolve to `ROLE_UNSPECIFIED` to avoid throwing in hot paths. */
export function toCoreRole(role: 'agent' | 'user'): V1Role {
  if (role === 'user') return V1Role.ROLE_USER;
  if (role === 'agent') return V1Role.ROLE_AGENT;
  return V1Role.ROLE_UNSPECIFIED;
}

export function toCompatRole(role: V1Role): 'agent' | 'user' {
  return role === V1Role.ROLE_USER ? 'user' : 'agent';
}

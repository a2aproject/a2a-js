/**
 * Shared enum translators for v1.0 ↔ v0.3 conversions.
 */

import { Role as V1Role, TaskState as V1TaskState } from '../../../types/pb/a2a.js';
import type { TaskStatus as LegacyTaskStatus } from '../types/types.js';

/**
 * The v0.3 JSON `TaskStatus.state` string-literal union, kept around as a
 * narrowed alias so call sites don't have to spell it out repeatedly.
 */
type LegacyTaskState = LegacyTaskStatus['state'];

/** v0.3 JSON `TaskState` literal → v1.0 proto `TaskState` enum. */
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

/** v1.0 proto `TaskState` enum → v0.3 JSON `TaskState` literal. */
const TASK_STATE_CORE_TO_COMPAT: ReadonlyMap<V1TaskState, LegacyTaskState> = new Map(
  (Object.entries(TASK_STATE_COMPAT_TO_CORE) as [LegacyTaskState, V1TaskState][]).map(
    ([literal, enumValue]) => [enumValue, literal]
  )
);

/**
 * Translates a v0.3 JSON `TaskState` string literal to its v1.0 proto enum
 * value. Falls back to `TASK_STATE_UNSPECIFIED` for any unknown literal (the
 * v0.3 JSON type already enumerates every legal value, so this branch is
 * effectively defensive).
 */
export function toCoreTaskState(state: LegacyTaskState): V1TaskState {
  return TASK_STATE_COMPAT_TO_CORE[state] ?? V1TaskState.TASK_STATE_UNSPECIFIED;
}

/**
 * Translates a v1.0 proto `TaskState` enum value to its v0.3 JSON string
 * literal. Unmapped values (including `UNRECOGNIZED`) become `'unknown'`.
 */
export function toCompatTaskState(state: V1TaskState): LegacyTaskState {
  return TASK_STATE_CORE_TO_COMPAT.get(state) ?? 'unknown';
}

/**
 * Translates a v0.3 JSON `role` literal to its v1.0 proto enum value.
 *
 * Inputs other than `'user'` or `'agent'` resolve to `ROLE_UNSPECIFIED` to
 * avoid throwing inside protocol-translation hot paths; callers that care
 * about unknown roles should validate upstream.
 */
export function toCoreRole(role: 'agent' | 'user'): V1Role {
  if (role === 'user') return V1Role.ROLE_USER;
  if (role === 'agent') return V1Role.ROLE_AGENT;
  return V1Role.ROLE_UNSPECIFIED;
}

/**
 * Translates a v1.0 proto `Role` enum value to its v0.3 JSON literal.
 */
export function toCompatRole(role: V1Role): 'agent' | 'user' {
  return role === V1Role.ROLE_USER ? 'user' : 'agent';
}

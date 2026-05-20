/**
 * `Task`, `TaskStatus`, and streaming-update event translators between
 * v1.0 proto and v0.3 JSON.
 *
 * The notable mismatch handled here is `TaskStatusUpdateEvent.final`:
 * v0.3 JSON requires it, v1.0 proto has no equivalent field. Going
 * v1.0 → v0.3 we compute `final` from the task state using the rule that
 * `final = state ∈ {completed, canceled, failed, rejected}`. Going
 * v0.3 → v1.0 we simply drop the field.
 */

import { toCompatTaskState, toCoreTaskState } from './enums.js';
import { toCompatMessage, toCoreMessage } from './messages.js';
import { toCompatArtifact, toCoreArtifact } from './artifacts.js';
import type {
  Task as V1Task,
  TaskArtifactUpdateEvent as V1TaskArtifactUpdateEvent,
  TaskStatus as V1TaskStatus,
  TaskStatusUpdateEvent as V1TaskStatusUpdateEvent,
} from '../../../types/pb/a2a.js';
import type * as legacy from '../types/types.js';
import { deepCloneMetadata } from './_clone.js';
import { A2AError } from '../server/error.js';

/**
 * Terminal v0.3 task states for which a `status-update` event should be
 * marked as `final: true`.
 *
 * Note: interrupted states (`'input-required'`, `'auth-required'`) are
 * intentionally NOT considered final.
 */
const FINAL_LEGACY_STATES: ReadonlySet<legacy.TaskStatus['state']> = new Set([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

/**
 * Converts a v0.3 JSON `TaskStatus` into a v1.0 proto `TaskStatus`.
 */
export function toCoreTaskStatus(compatStatus: legacy.TaskStatus): V1TaskStatus {
  return {
    state: toCoreTaskState(compatStatus.state),
    message: compatStatus.message ? toCoreMessage(compatStatus.message) : undefined,
    timestamp: compatStatus.timestamp,
  };
}

/**
 * Converts a v1.0 proto `TaskStatus` into a v0.3 JSON `TaskStatus`.
 *
 * Empty `timestamp` strings collapse to `undefined` since v0.3 JSON marks
 * the field optional.
 */
export function toCompatTaskStatus(coreStatus: V1TaskStatus): legacy.TaskStatus {
  const result: legacy.TaskStatus = { state: toCompatTaskState(coreStatus.state) };
  if (coreStatus.message) {
    result.message = toCompatMessage(coreStatus.message);
  }
  if (coreStatus.timestamp !== undefined && coreStatus.timestamp !== '') {
    result.timestamp = coreStatus.timestamp;
  }
  return result;
}

/**
 * Converts a v0.3 JSON `Task` into a v1.0 proto `Task`.
 *
 * Optional `artifacts` / `history` arrays collapse to empty arrays.
 * If `status` is missing the result carries a `TASK_STATE_UNSPECIFIED`
 * placeholder.
 */
export function toCoreTask(compatTask: legacy.Task): V1Task {
  return {
    id: compatTask.id,
    contextId: compatTask.contextId,
    status: toCoreTaskStatus(compatTask.status),
    artifacts: compatTask.artifacts ? compatTask.artifacts.map(toCoreArtifact) : [],
    history: compatTask.history ? compatTask.history.map(toCoreMessage) : [],
    metadata: deepCloneMetadata(compatTask.metadata),
  };
}

/**
 * Converts a v1.0 proto `Task` into a v0.3 JSON `Task`.
 *
 * Adds the `kind: 'task'` discriminator. Empty arrays are pruned so
 * v0.3 consumers see truly-optional fields when nothing was provided.
 * A missing `status` is replaced with `{ state: 'unknown' }` so the
 * v0.3 schema (which requires `status`) remains satisfied.
 */
export function toCompatTask(coreTask: V1Task): legacy.Task {
  const result: legacy.Task = {
    kind: 'task',
    id: coreTask.id,
    contextId: coreTask.contextId,
    status: coreTask.status ? toCompatTaskStatus(coreTask.status) : { state: 'unknown' },
  };

  if (coreTask.history.length > 0) {
    result.history = coreTask.history.map(toCompatMessage);
  }
  if (coreTask.artifacts.length > 0) {
    result.artifacts = coreTask.artifacts.map(toCompatArtifact);
  }
  const metadata = deepCloneMetadata(coreTask.metadata);
  if (metadata !== undefined) result.metadata = metadata;

  return result;
}

/**
 * Converts a v0.3 JSON `TaskStatusUpdateEvent` into a v1.0 proto
 * `TaskStatusUpdateEvent`.
 *
 * Drops the v0.3-only `final` field — v1.0 has no equivalent and the
 * receiver computes terminality from the status state.
 */
export function toCoreTaskStatusUpdateEvent(
  compatEvent: legacy.TaskStatusUpdateEvent
): V1TaskStatusUpdateEvent {
  return {
    taskId: compatEvent.taskId,
    contextId: compatEvent.contextId,
    status: toCoreTaskStatus(compatEvent.status),
    metadata: deepCloneMetadata(compatEvent.metadata),
  };
}

/**
 * Converts a v1.0 proto `TaskStatusUpdateEvent` into a v0.3 JSON
 * `TaskStatusUpdateEvent`.
 *
 * Computes `final` from the (translated) status state. The legacy
 * `kind: 'status-update'` discriminator is added so the result can be
 * embedded in the v0.3 streaming-response union.
 */
export function toCompatTaskStatusUpdateEvent(
  coreEvent: V1TaskStatusUpdateEvent
): legacy.TaskStatusUpdateEvent {
  const status: legacy.TaskStatus = coreEvent.status
    ? toCompatTaskStatus(coreEvent.status)
    : { state: 'unknown' };

  const result: legacy.TaskStatusUpdateEvent = {
    kind: 'status-update',
    taskId: coreEvent.taskId,
    contextId: coreEvent.contextId,
    status,
    final: FINAL_LEGACY_STATES.has(status.state),
  };
  const metadata = deepCloneMetadata(coreEvent.metadata);
  if (metadata !== undefined) result.metadata = metadata;
  return result;
}

/**
 * Converts a v0.3 JSON `TaskArtifactUpdateEvent` into a v1.0 proto
 * `TaskArtifactUpdateEvent`.
 *
 * Optional boolean fields default to `false` (proto3 convention).
 */
export function toCoreTaskArtifactUpdateEvent(
  compatEvent: legacy.TaskArtifactUpdateEvent
): V1TaskArtifactUpdateEvent {
  return {
    taskId: compatEvent.taskId,
    contextId: compatEvent.contextId,
    artifact: toCoreArtifact(compatEvent.artifact),
    append: compatEvent.append ?? false,
    lastChunk: compatEvent.lastChunk ?? false,
    metadata: deepCloneMetadata(compatEvent.metadata),
  };
}

/**
 * Converts a v1.0 proto `TaskArtifactUpdateEvent` into a v0.3 JSON
 * `TaskArtifactUpdateEvent`.
 *
 * The legacy `kind: 'artifact-update'` discriminator is added.
 * The optional `append` / `lastChunk` booleans are preserved as-is so a
 * server explicitly emitting `false` is round-trip-stable.
 */
export function toCompatTaskArtifactUpdateEvent(
  coreEvent: V1TaskArtifactUpdateEvent
): legacy.TaskArtifactUpdateEvent {
  if (!coreEvent.artifact) {
    throw A2AError.invalidParams('Invalid TaskArtifactUpdateEvent: missing artifact');
  }

  const result: legacy.TaskArtifactUpdateEvent = {
    kind: 'artifact-update',
    taskId: coreEvent.taskId,
    contextId: coreEvent.contextId,
    artifact: toCompatArtifact(coreEvent.artifact),
    append: coreEvent.append,
    lastChunk: coreEvent.lastChunk,
  };
  const metadata = deepCloneMetadata(coreEvent.metadata);
  if (metadata !== undefined) result.metadata = metadata;
  return result;
}

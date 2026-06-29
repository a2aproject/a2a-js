// `Task`, `TaskStatus`, and update-event translators. Notable mismatch:
// v0.3 `TaskStatusUpdateEvent.final` has no v1.0 equivalent; v1.0 → v0.3
// computes it from the task state.

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

// Interrupted states (`input-required`, `auth-required`) are NOT final.
const FINAL_LEGACY_STATES: ReadonlySet<legacy.TaskStatus['state']> = new Set([
  'completed',
  'canceled',
  'failed',
  'rejected',
]);

export function toCoreTaskStatus(compatStatus: legacy.TaskStatus): V1TaskStatus {
  return {
    state: toCoreTaskState(compatStatus.state),
    message: compatStatus.message ? toCoreMessage(compatStatus.message) : undefined,
    timestamp: compatStatus.timestamp,
  };
}

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

/** Drops `final` — v1.0 computes terminality from the status state. */
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

/** Computes `final` from the status state; adds the `kind` discriminator. */
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

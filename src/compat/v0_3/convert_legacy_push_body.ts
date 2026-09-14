import type {
  Message as V1Message,
  Task as V1Task,
  TaskArtifactUpdateEvent as V1TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent as V1TaskStatusUpdateEvent,
} from '../../types/pb/a2a.js';
import { A2AError } from './server/error.js';
import { toCoreMessage } from './translate/messages.js';
import {
  toCoreTask,
  toCoreTaskArtifactUpdateEvent,
  toCoreTaskStatusUpdateEvent,
} from './translate/tasks.js';
import type * as legacy from './types/types.js';

/**
 * Converts a raw v0.3 push notification body to its v1.0 equivalent.
 *
 * Use this when you receive a v0.3 push notification on your own webhook
 * route and need a v1.0 object to pass into your pipeline. The internal
 * translators stay free to change; only the input/output contract is stable.
 *
 * Throws {@link A2AError} (invalidParams) for unrecognised or malformed payloads.
 */
export function convertLegacyPushBody(
  body: unknown
): V1Task | V1Message | V1TaskStatusUpdateEvent | V1TaskArtifactUpdateEvent {
  if (body === null || typeof body !== 'object' || !('kind' in body)) {
    throw A2AError.invalidParams('v0.3 push body must be an object with a kind field');
  }
  const kind = (body as { kind: unknown }).kind;
  switch (kind) {
    case 'task':
      return toCoreTask(body as legacy.Task);
    case 'message':
      return toCoreMessage(body as legacy.Message);
    case 'status-update':
      return toCoreTaskStatusUpdateEvent(body as legacy.TaskStatusUpdateEvent);
    case 'artifact-update':
      return toCoreTaskArtifactUpdateEvent(body as legacy.TaskArtifactUpdateEvent);
    default:
      throw A2AError.invalidParams(`Unknown v0.3 push body kind: ${String(kind)}`);
  }
}

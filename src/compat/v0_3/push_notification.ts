/**
 * Receiving side of the v0.3 push-notification webhook.
 *
 * `V03PushNotificationSerializer` writes a bare v0.3 event as the request
 * body: a `Task`, `Message`, `TaskStatusUpdateEvent` or
 * `TaskArtifactUpdateEvent`, with no `StreamResponse` wrapper and no
 * JSON-RPC envelope. This is the inverse, for receivers that cannot make
 * the sending agent speak v1.0. Those four events are exactly the arms of
 * the v1.0 `StreamResponse` payload union, so the return type is closed.
 *
 * The translators underneath stay private. This function is the public
 * entry point for receivers, so the translation logic behind it stays
 * free to change.
 */

import type { StreamResponse } from '../../types/pb/a2a.js';
import type * as legacy from './types/types.js';
import { A2AError } from './server/error.js';
import { requireObject, requireString } from './translate/_validate.js';
import { toCoreMessage } from './translate/messages.js';
import {
  toCoreTask,
  toCoreTaskArtifactUpdateEvent,
  toCoreTaskStatusUpdateEvent,
} from './translate/tasks.js';

/**
 * Converts a raw v0.3 push-notification body into a v1.0
 * {@link StreamResponse}.
 *
 * Pass the parsed JSON request body. Switch on `payload.$case` (`'task'`,
 * `'message'`, `'statusUpdate'`, `'artifactUpdate'`) to handle the event.
 *
 * Identity fields that both protocol versions mark required (`id` /
 * `taskId`, `contextId`) are checked here, because a receiver gets this
 * body from an agent it does not control and a half-populated result
 * would not match its own declared type.
 *
 * @throws `A2AError.invalidParams` if the body is not a recognized v0.3
 * event or is missing a required field.
 */
export function legacyPushNotificationToV1StreamResponse(body: unknown): StreamResponse {
  requireObject(body, 'push notification body');
  const event = body as { kind?: unknown };

  switch (event.kind) {
    case 'task': {
      const task = body as legacy.Task;
      requireString(task.id, 'task.id');
      requireString(task.contextId, 'task.contextId');
      requireObject(task.status, 'task.status');
      return { payload: { $case: 'task', value: toCoreTask(task) } };
    }
    case 'message': {
      // `toCoreMessage` already validates messageId, role and parts.
      return { payload: { $case: 'message', value: toCoreMessage(body as legacy.Message) } };
    }
    case 'status-update': {
      const update = body as legacy.TaskStatusUpdateEvent;
      requireString(update.taskId, 'status-update.taskId');
      requireString(update.contextId, 'status-update.contextId');
      requireObject(update.status, 'status-update.status');
      return {
        payload: { $case: 'statusUpdate', value: toCoreTaskStatusUpdateEvent(update) },
      };
    }
    case 'artifact-update': {
      const update = body as legacy.TaskArtifactUpdateEvent;
      requireString(update.taskId, 'artifact-update.taskId');
      requireString(update.contextId, 'artifact-update.contextId');
      requireObject(update.artifact, 'artifact-update.artifact');
      return {
        payload: { $case: 'artifactUpdate', value: toCoreTaskArtifactUpdateEvent(update) },
      };
    }
    default:
      throw A2AError.invalidParams(
        `Unrecognized v0.3 push notification body: kind must be "task", "message", "status-update" or "artifact-update", got ${JSON.stringify(event.kind)}`
      );
  }
}

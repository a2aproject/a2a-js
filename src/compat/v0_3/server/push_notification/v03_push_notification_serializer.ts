import {
  PushNotificationSerializer,
  SerializedPushNotification,
} from '../../../../server/push_notification/push_notification_serializer.js';
import { StreamResponse } from '../../../../index.js';
import { LEGACY_JSON_CONTENT_TYPE } from '../../constants.js';
import {
  toCompatTask,
  toCompatTaskArtifactUpdateEvent,
  toCompatTaskStatusUpdateEvent,
} from '../../translate/tasks.js';
import { toCompatMessage } from '../../translate/messages.js';

/**
 * v0.3 push-notification serializer. The body is the bare v0.3 event
 * object (`Task`, `Message`, `TaskStatusUpdateEvent`, or
 * `TaskArtifactUpdateEvent`) — no `StreamResponse` wrapper and no
 * JSON-RPC envelope.
 */
export class V03PushNotificationSerializer implements PushNotificationSerializer {
  serialize(streamResponse: StreamResponse): SerializedPushNotification {
    const payload = streamResponse.payload;
    if (!payload) {
      throw new Error('StreamResponse payload is undefined');
    }

    let legacyEvent: unknown;
    switch (payload.$case) {
      case 'task':
        legacyEvent = toCompatTask(payload.value);
        break;
      case 'message':
        legacyEvent = toCompatMessage(payload.value);
        break;
      case 'statusUpdate':
        legacyEvent = toCompatTaskStatusUpdateEvent(payload.value);
        break;
      case 'artifactUpdate':
        legacyEvent = toCompatTaskArtifactUpdateEvent(payload.value);
        break;
      default: {
        // Exhaustive check on the `StreamResponse` payload union.
        const _exhaustive: never = payload;
        throw new Error(`Unknown payload case: ${(_exhaustive as { $case: string }).$case}`);
      }
    }

    return {
      body: JSON.stringify(legacyEvent),
      contentType: LEGACY_JSON_CONTENT_TYPE,
    };
  }
}

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
 * The v0.3 push notification serializer.
 *
 * Per the v0.3 spec example (§9.5), the push-notification HTTP body is the
 * **bare event object** (a v0.3 JSON `Task`, `Message`,
 * `TaskStatusUpdateEvent`, or `TaskArtifactUpdateEvent` discriminated by
 * its `kind` field) with `Content-Type: application/json`. Notably:
 *
 *  - It is **not** wrapped in a `StreamResponse` discriminator (no outer
 *    `task` / `message` / `statusUpdate` / `artifactUpdate` key) — that
 *    wrapper is a v1.0 addition (§4.3.3).
 *  - It is **not** wrapped in a JSON-RPC envelope (no `jsonrpc`, `id`,
 *    `result`) — push notifications are unsolicited and have no in-flight
 *    request to correlate against; the JSON-RPC envelope only appears on
 *    the streaming (SSE) path in v0.3.
 *
 * The canonical {@link StreamResponse} payload is translated to the v0.3
 * JSON shape via the per-case `toCompat*` translators in
 * `compat/v0_3/translate/`, which set the legacy `kind` discriminator
 * (`'task'`, `'message'`, `'status-update'`, or `'artifact-update'`) the
 * v0.3 schema requires.
 *
 * All four payload variants are handled per spec §4.3.3.
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
        // Exhaustive check: keeps this switch in sync with the StreamResponse
        // payload union at compile time.
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

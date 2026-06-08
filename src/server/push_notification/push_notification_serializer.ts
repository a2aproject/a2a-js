import { StreamResponse } from '../../index.js';
import { A2A_CONTENT_TYPE } from '../../constants.js';

/**
 * The serialized HTTP body and content type for a single push-notification
 * dispatch.
 */
export interface SerializedPushNotification {
  /** The HTTP body to POST to the webhook URL. */
  body: string;
  /** The value to set on the `Content-Type` request header. */
  contentType: string;
}

/**
 * Strategy for converting a canonical {@link StreamResponse} into the
 * on-the-wire body of a single push-notification HTTP POST.
 *
 * The {@link DefaultPushNotificationSender} resolves a serializer per
 * registered push-notification config based on the wire version the config
 * was registered over (e.g. `'1.0'` for the current spec, `'0.3'` for the
 * legacy compat layer). This allows v0.3-registered webhooks to keep
 * receiving the v0.3-shaped JSON payload long after the original
 * registration request has returned.
 */
export interface PushNotificationSerializer {
  /**
   * Serializes a {@link StreamResponse} into the HTTP body + content type
   * for one push-notification dispatch.
   *
   * Implementations MUST handle all four `StreamResponse` payload variants
   * (`task`, `message`, `statusUpdate`, `artifactUpdate`) per spec §4.3.3.
   * Any error thrown from this method aborts the dispatch and is logged by
   * the sender; it does NOT propagate to the event loop or the caller.
   */
  serialize(streamResponse: StreamResponse): SerializedPushNotification;
}

/**
 * The canonical v1.0 push-notification serializer (per spec §4.3.3).
 *
 * The body is the `StreamResponse` discriminated union encoded as JSON via
 * the generated proto's `toJSON`, and the content type is
 * `application/a2a+json`.
 */
export class V1PushNotificationSerializer implements PushNotificationSerializer {
  serialize(streamResponse: StreamResponse): SerializedPushNotification {
    return {
      body: JSON.stringify(StreamResponse.toJSON(streamResponse)),
      contentType: A2A_CONTENT_TYPE,
    };
  }
}

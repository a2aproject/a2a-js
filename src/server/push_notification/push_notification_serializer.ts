import { StreamResponse } from '../../index.js';
import { A2A_CONTENT_TYPE } from '../../constants.js';

/** HTTP body and content type for a single push-notification dispatch. */
export interface SerializedPushNotification {
  /** The HTTP body to POST to the webhook URL. */
  body: string;
  /** The value to set on the `Content-Type` request header. */
  contentType: string;
}

/**
 * Strategy for converting a {@link StreamResponse} into the on-the-wire
 * body of a single push-notification HTTP POST. Implementations MUST
 * handle all four `StreamResponse` payload variants. Errors thrown abort
 * the dispatch and are logged; they do NOT propagate to the caller.
 *
 * {@link DefaultPushNotificationSender} resolves a serializer per
 * registered config based on the wire version the config was registered
 * over, so v0.3-registered webhooks keep receiving v0.3-shaped payloads.
 */
export interface PushNotificationSerializer {
  serialize(streamResponse: StreamResponse): SerializedPushNotification;
}

/**
 * The canonical v1.0 push-notification serializer: `StreamResponse`
 * encoded as JSON via the generated proto's `toJSON`, with content type
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

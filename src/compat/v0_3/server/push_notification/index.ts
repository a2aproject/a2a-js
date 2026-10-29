/**
 * v0.3 push-notification serializer plus a factory that pre-registers it
 * on a `DefaultPushNotificationSender`.
 */

import {
  DefaultPushNotificationSender,
  type DefaultPushNotificationSenderOptions,
} from '../../../../server/push_notification/default_push_notification_sender.js';
import type { PushNotificationStore } from '../../../../server/push_notification/push_notification_store.js';
import { ProtocolVersion } from '../../../../constants.js';
import { V03PushNotificationSerializer } from './v03_push_notification_serializer.js';

export { V03PushNotificationSerializer };

/**
 * Constructs a `DefaultPushNotificationSender` with the v0.3 serializer
 * pre-registered under `ProtocolVersion.V0_3`. Webhooks registered over
 * v0.3 transports are dispatched with the v0.3 body shape; v1.0
 * webhooks keep using the built-in v1.0 serializer. User-supplied
 * `serializers` in `options` take precedence.
 */
export function createLegacyAwarePushNotificationSender(
  pushNotificationStore: PushNotificationStore,
  options: DefaultPushNotificationSenderOptions = {}
): DefaultPushNotificationSender {
  return new DefaultPushNotificationSender(pushNotificationStore, {
    ...options,
    serializers: {
      [ProtocolVersion.V0_3]: new V03PushNotificationSerializer(),
      ...(options.serializers ?? {}),
    },
  });
}

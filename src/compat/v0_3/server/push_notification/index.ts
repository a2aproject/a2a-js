/**
 * v0.3 compat-layer push-notification serializer and helpers.
 *
 * The canonical push-notification machinery (store, sender) lives in
 * `src/server/push_notification/`. This module adds the v0.3-aware
 * serializer + a convenience factory that pre-registers it on a
 * {@link DefaultPushNotificationSender}, so deployments that mount the
 * v0.3 compat transports can deliver webhooks in the v0.3 wire format
 * without manually wiring the serializer.
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
 * Constructs a {@link DefaultPushNotificationSender} with the v0.3
 * serializer pre-registered under {@link ProtocolVersion.V0_3} (`'0.3'`).
 *
 * Webhooks registered over v0.3 transports (e.g. legacy gRPC, legacy
 * JSON-RPC, legacy REST) carry their wire version through the
 * {@link PushNotificationStore} (when it implements `loadWithMetadata`)
 * and are dispatched with the v0.3-shaped body + `application/json`
 * content type. Webhooks registered over the canonical v1.0 transports
 * continue to use the built-in v1.0 serializer.
 *
 * Callers can override the pre-registered v0.3 entry — or add serializers
 * for other versions — by supplying their own `serializers` map in
 * `options`; user-supplied entries take precedence.
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

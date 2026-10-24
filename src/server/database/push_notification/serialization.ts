import { A2A_LEGACY_PROTOCOL_VERSION } from '../../../constants.js';
import { TaskPushNotificationConfig } from '../../../types/index.js';
import type { StoredPushNotificationConfig } from '../../push_notification/push_notification_store.js';
import { requireKey } from '../../utils.js';
import type { PushNotificationConfigRow } from './schema.js';

export interface PushNotificationConfigScope {
  readonly tenant: string;
  readonly owner: string;
  readonly taskId: string;
}

/** Held in columns, so they are dropped from the payload. */
const COLUMN_BACKED_FIELDS = ['tenant', 'id', 'taskId'] as const;

/** Format of the payload columns. Written, never read. */
const PAYLOAD_FORMAT = '1.0';

const SUBJECT = 'push notification config';

export function toPushNotificationConfigRow(
  scope: PushNotificationConfigScope,
  stored: StoredPushNotificationConfig
): PushNotificationConfigRow {
  requireKey(SUBJECT, 'tenant', scope.tenant);
  requireKey(SUBJECT, 'owner', scope.owner);
  requireKey(SUBJECT, 'task id', scope.taskId);
  requireKey(SUBJECT, 'id', stored.config.id);

  // toJSON returns a fresh object, so deleting cannot reach the config.
  const payload = TaskPushNotificationConfig.toJSON(stored.config) as Record<string, unknown>;
  for (const field of COLUMN_BACKED_FIELDS) {
    delete payload[field];
  }

  return {
    tenant: scope.tenant,
    owner: scope.owner,
    task_id: scope.taskId,
    config_id: stored.config.id,
    config_data: JSON.stringify({ ...payload, wireVersion: stored.wireVersion }),
    protocol_version: PAYLOAD_FORMAT,
  };
}

// A null payload, which the schema permits, reads as an empty one.
export function fromPushNotificationConfigRow(
  row: PushNotificationConfigRow
): StoredPushNotificationConfig {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.config_data || '{}') as Record<string, unknown>;
  } catch (cause) {
    throw new Error(`push notification config "${row.config_id}" is not readable`, { cause });
  }

  return {
    // fromJSON reads its own fields and ignores wireVersion.
    config: TaskPushNotificationConfig.fromJSON({
      ...payload,
      tenant: row.tenant,
      id: row.config_id,
      taskId: row.task_id,
    }),
    wireVersion: String(payload.wireVersion || A2A_LEGACY_PROTOCOL_VERSION),
  };
}

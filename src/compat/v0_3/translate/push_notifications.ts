/**
 * Push-notification translators. Two mismatches: v1.0 `scheme` is a
 * single string while v0.3 `schemes` is an array (v0.3 → v1.0 keeps
 * only the first); v1.0 flattens `TaskPushNotificationConfig` while
 * v0.3 nests everything except `taskId` under `pushNotificationConfig`.
 */

import type {
  AuthenticationInfo as V1AuthenticationInfo,
  TaskPushNotificationConfig as V1TaskPushNotificationConfig,
} from '../../../types/pb/a2a.js';
import type * as legacy from '../types/types.js';

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

/** Lossy when `schemes.length > 1` — only the first scheme is kept. */
export function toCoreAuthenticationInfo(
  compat: legacy.PushNotificationAuthenticationInfo
): V1AuthenticationInfo {
  if (compat.schemes && compat.schemes.length > 1) {
    console.warn(
      `toCoreAuthenticationInfo: Lossy conversion from v0.3 PushNotificationAuthenticationInfo to v1.0 AuthenticationInfo. Multiple schemes declared (${compat.schemes.join(', ')}), but only the first one ('${compat.schemes[0]}') will be kept.`
    );
  }
  return {
    scheme: compat.schemes && compat.schemes.length > 0 ? compat.schemes[0]! : '',
    credentials: compat.credentials ?? '',
  };
}

export function toCompatAuthenticationInfo(
  core: V1AuthenticationInfo
): legacy.PushNotificationAuthenticationInfo {
  const result: legacy.PushNotificationAuthenticationInfo = {
    schemes: core.scheme !== '' ? [core.scheme] : [],
  };
  const credentials = nonEmpty(core.credentials);
  if (credentials !== undefined) result.credentials = credentials;
  return result;
}

/**
 * Converts the inner v0.3 `PushNotificationConfig`. Caller fills in
 * `taskId` when stitching together a full `TaskPushNotificationConfig`;
 * `tenant` defaults to `''` (global).
 */
export function toCorePushNotificationConfig(
  compat: legacy.PushNotificationConfig | legacy.PushNotificationConfig1,
  tenant: string = ''
): V1TaskPushNotificationConfig {
  return {
    tenant,
    taskId: '',
    id: compat.id ?? '',
    url: compat.url,
    token: compat.token ?? '',
    authentication: compat.authentication
      ? toCoreAuthenticationInfo(compat.authentication)
      : undefined,
  };
}

/** Drops `taskId` — v0.3 stores it at the outer level. */
export function toCompatPushNotificationConfig(
  core: V1TaskPushNotificationConfig
): legacy.PushNotificationConfig {
  const result: legacy.PushNotificationConfig = { url: core.url };

  const id = nonEmpty(core.id);
  if (id !== undefined) result.id = id;

  const token = nonEmpty(core.token);
  if (token !== undefined) result.token = token;

  if (core.authentication) {
    result.authentication = toCompatAuthenticationInfo(core.authentication);
  }

  return result;
}

/** v0.3 has no tenants; caller may supply one. Defaults to `''` (global). */
export function toCoreTaskPushNotificationConfig(
  compat: legacy.TaskPushNotificationConfig,
  tenant: string = ''
): V1TaskPushNotificationConfig {
  return {
    tenant,
    taskId: compat.taskId,
    id: compat.pushNotificationConfig.id ?? '',
    url: compat.pushNotificationConfig.url,
    token: compat.pushNotificationConfig.token ?? '',
    authentication: compat.pushNotificationConfig.authentication
      ? toCoreAuthenticationInfo(compat.pushNotificationConfig.authentication)
      : undefined,
  };
}

export function toCompatTaskPushNotificationConfig(
  core: V1TaskPushNotificationConfig
): legacy.TaskPushNotificationConfig {
  return {
    taskId: core.taskId,
    pushNotificationConfig: toCompatPushNotificationConfig(core),
  };
}

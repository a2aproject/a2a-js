/**
 * Push-notification translators between v1.0 proto and v0.3 JSON.
 *
 * Two structural differences need bridging:
 *
 *  - **Authentication info.** v1.0 `AuthenticationInfo.scheme` is a single
 *    string (e.g. `'Bearer'`); v0.3
 *    `PushNotificationAuthenticationInfo.schemes` is a string array. Going
 *    v0.3 → v1.0 we take the first scheme (lossy when more than one is
 *    declared) Going v1.0 → v0.3 we wrap
 *    the single scheme into a one-element array (empty when the v1.0
 *    `scheme` is empty).
 *
 *  - **TaskPushNotificationConfig nesting.** v1.0 flattens
 *    `(taskId, id, url, token, authentication)` onto a single message;
 *    v0.3 JSON nests `(id, url, token, authentication)` under
 *    `pushNotificationConfig` and keeps `taskId` at the outer level.
 */

import type {
  AuthenticationInfo as V1AuthenticationInfo,
  TaskPushNotificationConfig as V1TaskPushNotificationConfig,
} from '../../../types/pb/a2a.js';
import type * as legacy from '../types/types.js';

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

/**
 * Converts a v0.3 JSON `PushNotificationAuthenticationInfo` into a v1.0
 * proto `AuthenticationInfo`.
 *
 * **Lossy when `schemes.length > 1`** — only the first scheme is kept.
 * Callers that need to preserve all declared schemes must do so out-of-band.
 */
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

/**
 * Converts a v1.0 proto `AuthenticationInfo` into a v0.3 JSON
 * `PushNotificationAuthenticationInfo`.
 *
 * The single v1.0 `scheme` is wrapped into a one-element array; an empty
 * scheme becomes an empty array. Empty credentials collapse to `undefined`.
 */
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
 * Converts a v0.3 JSON `PushNotificationConfig` (the inner record) into a
 * v1.0 proto `TaskPushNotificationConfig` minus its `taskId` (the caller
 * supplies that when stitching together a full
 * `TaskPushNotificationConfig`). `taskId` is set to the proto3
 * empty-string default; `tenant` defaults to `''` (global tenant) and
 * may be overridden by the caller — typically by
 * `toCoreTaskPushNotificationConfig` plumbing the URL tenant.
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

/**
 * Converts a v1.0 proto `TaskPushNotificationConfig` into the inner v0.3
 * JSON `PushNotificationConfig` record (drops the `taskId`, which v0.3
 * stores at the outer `TaskPushNotificationConfig` level).
 */
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

/**
 * Converts a v0.3 JSON `TaskPushNotificationConfig` (with the nested
 * `pushNotificationConfig`) into a v1.0 proto flat
 * `TaskPushNotificationConfig`.
 *
 * v0.3 has no concept of tenants; the caller may supply the v1.0
 * `tenant` value out-of-band. Defaults to `''` (global tenant).
 */
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

/**
 * Converts a v1.0 proto `TaskPushNotificationConfig` into a v0.3 JSON
 * `TaskPushNotificationConfig` (re-nesting the per-config fields under
 * `pushNotificationConfig`).
 */
export function toCompatTaskPushNotificationConfig(
  core: V1TaskPushNotificationConfig
): legacy.TaskPushNotificationConfig {
  return {
    taskId: core.taskId,
    pushNotificationConfig: toCompatPushNotificationConfig(core),
  };
}

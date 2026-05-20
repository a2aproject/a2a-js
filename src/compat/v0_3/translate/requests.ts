/**
 * RPC request/response translators between v1.0 proto and v0.3 JSON.
 *
 * Each v0.3 JSON-RPC request type wraps its parameters under
 * `.params`; the v1.0 proto types are flat. These helpers cross that
 * boundary so transport layers can call into a v1.0 handler with the v1
 * proto types while presenting/parsing the v0.3 JSON-RPC wire format to
 * legacy clients.
 *
 * **`returnImmediately` ↔ `blocking` polarity inversion.** The v1.0
 * `SendMessageConfiguration.returnImmediately` field is the logical
 * inverse of v0.3 `MessageSendConfiguration.blocking`. We translate as
 * `return_immediately = !blocking` (and back)
 *
 * Going v1.0 → v0.3 we need a JSON-RPC `id` to populate the response
 * envelope; callers supply it explicitly as the `requestId` argument.
 */

import { A2AError } from '../server/error.js';
import { toCompatMessage, toCoreMessage } from './messages.js';
import {
  toCompatPushNotificationConfig,
  toCompatTaskPushNotificationConfig,
  toCorePushNotificationConfig,
  toCoreTaskPushNotificationConfig,
} from './push_notifications.js';
import {
  toCompatTask,
  toCompatTaskArtifactUpdateEvent,
  toCompatTaskStatusUpdateEvent,
  toCoreTask,
  toCoreTaskArtifactUpdateEvent,
  toCoreTaskStatusUpdateEvent,
} from './tasks.js';
import type {
  CancelTaskRequest as V1CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest as V1DeleteTaskPushNotificationConfigRequest,
  GetExtendedAgentCardRequest as V1GetExtendedAgentCardRequest,
  GetTaskPushNotificationConfigRequest as V1GetTaskPushNotificationConfigRequest,
  GetTaskRequest as V1GetTaskRequest,
  ListTaskPushNotificationConfigsRequest as V1ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse as V1ListTaskPushNotificationConfigsResponse,
  SendMessageConfiguration as V1SendMessageConfiguration,
  SendMessageRequest as V1SendMessageRequest,
  SendMessageResponse as V1SendMessageResponse,
  StreamResponse as V1StreamResponse,
  SubscribeToTaskRequest as V1SubscribeToTaskRequest,
  TaskPushNotificationConfig as V1TaskPushNotificationConfig,
} from '../../../types/pb/a2a.js';
import type * as legacy from '../types/types.js';
import { deepCloneMetadata } from './_clone.js';

type RequestId = string | number;
type ResponseId = string | number | null;

/* --------------------------------- SendMessageConfiguration --------------------------------- */

/** v0.3 `MessageSendConfiguration` → v1.0 proto `SendMessageConfiguration`. */
export function toCoreSendMessageConfiguration(
  compat: legacy.MessageSendConfiguration
): V1SendMessageConfiguration {
  return {
    acceptedOutputModes: compat.acceptedOutputModes ? [...compat.acceptedOutputModes] : [],
    taskPushNotificationConfig: compat.pushNotificationConfig
      ? toCorePushNotificationConfig(compat.pushNotificationConfig)
      : undefined,
    historyLength: compat.historyLength,
    returnImmediately: compat.blocking === undefined ? true : !compat.blocking,
  };
}

/** v1.0 proto `SendMessageConfiguration` → v0.3 `MessageSendConfiguration`. */
export function toCompatSendMessageConfiguration(
  core: V1SendMessageConfiguration
): legacy.MessageSendConfiguration {
  const result: legacy.MessageSendConfiguration = {
    blocking: !core.returnImmediately,
  };
  // Always emit `acceptedOutputModes`, even when empty. v1.0 proto types
  // it as a required `string[]` (no `undefined` representation), and both
  // the v1.0 JSON serializer (`SendMessageConfiguration.toJSON`) and gRPC
  // `encode` treat `[]` and "absent" as wire-identical. Preserving the
  // empty array here keeps an explicit v0.3 `acceptedOutputModes: []`
  // round-trip-stable; the only observable cost is that a v0.3 caller
  // who originally omitted the field will see `[]` on the return path
  // rather than `undefined`, which carries no semantic change because
  // the v1.0 layer has already collapsed the distinction.
  result.acceptedOutputModes = [...core.acceptedOutputModes];
  if (core.historyLength !== undefined) result.historyLength = core.historyLength;
  if (core.taskPushNotificationConfig) {
    result.pushNotificationConfig = toCompatPushNotificationConfig(core.taskPushNotificationConfig);
  }
  return result;
}

/* --------------------------------- SendMessage --------------------------------- */

/**
 * v0.3 `SendMessageRequest` (or `SendStreamingMessageRequest`) →
 * v1.0 proto `SendMessageRequest`.
 */
export function toCoreSendMessageRequest(
  compat: legacy.SendMessageRequest | legacy.SendStreamingMessageRequest
): V1SendMessageRequest {
  return {
    tenant: '',
    message: toCoreMessage(compat.params.message),
    configuration: compat.params.configuration
      ? toCoreSendMessageConfiguration(compat.params.configuration)
      : undefined,
    metadata: deepCloneMetadata(compat.params.metadata),
  };
}

/**
 * v1.0 proto `SendMessageRequest` → v0.3 `SendMessageRequest`.
 *
 * The caller supplies the JSON-RPC `id` since the proto carries none.
 */
export function toCompatSendMessageRequest(
  core: V1SendMessageRequest,
  requestId: RequestId
): legacy.SendMessageRequest {
  if (!core.message) {
    throw A2AError.invalidParams('SendMessageRequest missing message');
  }
  const params: legacy.MessageSendParams = {
    message: toCompatMessage(core.message),
  };
  if (core.configuration) {
    params.configuration = toCompatSendMessageConfiguration(core.configuration);
  }
  const metadata = deepCloneMetadata(core.metadata);
  if (metadata !== undefined) params.metadata = metadata;
  return { id: requestId, jsonrpc: '2.0', method: 'message/send', params };
}

/**
 * v1.0 proto `SendMessageRequest` → v0.3 `SendStreamingMessageRequest`.
 *
 * Identical to `toCompatSendMessageRequest` except the method name is
 * `message/stream`.
 */
export function toCompatSendStreamingMessageRequest(
  core: V1SendMessageRequest,
  requestId: RequestId
): legacy.SendStreamingMessageRequest {
  const inner = toCompatSendMessageRequest(core, requestId);
  return { ...inner, method: 'message/stream' };
}

/* --------------------------------- SendMessageResponse --------------------------------- */

/**
 * v0.3 `SendMessageResponse` → v1.0 proto `SendMessageResponse`.
 *
 * Throws if the v0.3 response is an error envelope (callers should
 * surface errors via the v1.0 typed error classes instead).
 */
export function toCoreSendMessageResponse(
  compat: legacy.SendMessageResponse
): V1SendMessageResponse {
  if ('error' in compat) {
    throw A2AError.internalError(
      'Cannot translate a v0.3 error response into a v1.0 SendMessageResponse'
    );
  }
  const result = compat.result;
  if (result.kind === 'task') {
    return { payload: { $case: 'task', value: toCoreTask(result) } };
  }
  if (result.kind === 'message') {
    return { payload: { $case: 'message', value: toCoreMessage(result) } };
  }
  throw A2AError.invalidParams('Invalid v0.3 SendMessageResponse result');
}

/**
 * v1.0 proto `SendMessageResponse` → v0.3 success envelope
 * `SendMessageSuccessResponse`.
 *
 * Errors should be wrapped via the v0.3 JSON-RPC error envelope at the
 * transport layer rather than here.
 */
export function toCompatSendMessageResponse(
  core: V1SendMessageResponse,
  requestId: ResponseId = null
): legacy.SendMessageSuccessResponse {
  const payload = core.payload;
  if (!payload) {
    throw A2AError.internalError('SendMessageResponse missing payload');
  }
  let result: legacy.Task2 | legacy.Message1;
  if (payload.$case === 'task') {
    result = toCompatTask(payload.value);
  } else if (payload.$case === 'message') {
    result = toCompatMessage(payload.value);
  } else {
    throw A2AError.internalError('SendMessageResponse has unknown payload case');
  }
  return { id: requestId, jsonrpc: '2.0', result };
}

/* --------------------------------- StreamResponse --------------------------------- */

/**
 * v0.3 `SendStreamingMessageResponse` → v1.0 proto `StreamResponse`.
 *
 * The four success cases mirror the v1.0 oneof:
 * `Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent`.
 *
 * Throws if the v0.3 response is an error envelope (callers should
 * surface errors via the v1.0 typed error classes instead).
 */
export function toCoreStreamResponse(
  compat: legacy.SendStreamingMessageResponse
): V1StreamResponse {
  if ('error' in compat) {
    throw A2AError.internalError(
      'Cannot translate a v0.3 error response into a v1.0 StreamResponse'
    );
  }
  const result = compat.result;
  switch (result.kind) {
    case 'message':
      return { payload: { $case: 'message', value: toCoreMessage(result) } };
    case 'task':
      return { payload: { $case: 'task', value: toCoreTask(result) } };
    case 'status-update':
      return {
        payload: { $case: 'statusUpdate', value: toCoreTaskStatusUpdateEvent(result) },
      };
    case 'artifact-update':
      return {
        payload: { $case: 'artifactUpdate', value: toCoreTaskArtifactUpdateEvent(result) },
      };
    default:
      throw A2AError.invalidParams(
        `Unknown v0.3 stream event kind: ${String((result as { kind?: string }).kind)}`
      );
  }
}

/**
 * v1.0 proto `StreamResponse` → v0.3 `SendStreamingMessageSuccessResponse`.
 */
export function toCompatStreamResponse(
  core: V1StreamResponse,
  requestId: ResponseId = null
): legacy.SendStreamingMessageSuccessResponse {
  const payload = core.payload;
  if (!payload) {
    throw A2AError.internalError('StreamResponse missing payload');
  }
  let result: legacy.SendStreamingMessageSuccessResponse['result'];
  switch (payload.$case) {
    case 'message':
      result = toCompatMessage(payload.value);
      break;
    case 'task':
      result = toCompatTask(payload.value);
      break;
    case 'statusUpdate':
      result = toCompatTaskStatusUpdateEvent(payload.value);
      break;
    case 'artifactUpdate':
      result = toCompatTaskArtifactUpdateEvent(payload.value);
      break;
    default:
      throw A2AError.internalError('StreamResponse has unknown payload case');
  }
  return { id: requestId, jsonrpc: '2.0', result };
}

/* --------------------------------- GetTask --------------------------------- */

/** v0.3 `GetTaskRequest` → v1.0 proto `GetTaskRequest`. */
export function toCoreGetTaskRequest(compat: legacy.GetTaskRequest): V1GetTaskRequest {
  return {
    tenant: '',
    id: compat.params.id,
    historyLength: compat.params.historyLength,
  };
}

/** v1.0 proto `GetTaskRequest` → v0.3 `GetTaskRequest`. */
export function toCompatGetTaskRequest(
  core: V1GetTaskRequest,
  requestId: RequestId
): legacy.GetTaskRequest {
  const params: legacy.TaskQueryParams = { id: core.id };
  if (core.historyLength !== undefined) params.historyLength = core.historyLength;
  return { id: requestId, jsonrpc: '2.0', method: 'tasks/get', params };
}

/* --------------------------------- CancelTask --------------------------------- */

/** v0.3 `CancelTaskRequest` → v1.0 proto `CancelTaskRequest`. */
export function toCoreCancelTaskRequest(compat: legacy.CancelTaskRequest): V1CancelTaskRequest {
  return {
    tenant: '',
    id: compat.params.id,
    metadata: deepCloneMetadata(compat.params.metadata),
  };
}

/** v1.0 proto `CancelTaskRequest` → v0.3 `CancelTaskRequest`. */
export function toCompatCancelTaskRequest(
  core: V1CancelTaskRequest,
  requestId: RequestId
): legacy.CancelTaskRequest {
  const params: legacy.TaskIdParams = { id: core.id };
  const metadata = deepCloneMetadata(core.metadata);
  if (metadata !== undefined) params.metadata = metadata;
  return { id: requestId, jsonrpc: '2.0', method: 'tasks/cancel', params };
}

/* --------------------------------- SubscribeToTask --------------------------------- */

/** v0.3 `TaskResubscriptionRequest` → v1.0 proto `SubscribeToTaskRequest`. */
export function toCoreSubscribeToTaskRequest(
  compat: legacy.TaskResubscriptionRequest
): V1SubscribeToTaskRequest {
  return { tenant: '', id: compat.params.id };
}

/** v1.0 proto `SubscribeToTaskRequest` → v0.3 `TaskResubscriptionRequest`. */
export function toCompatTaskResubscriptionRequest(
  core: V1SubscribeToTaskRequest,
  requestId: RequestId
): legacy.TaskResubscriptionRequest {
  return {
    id: requestId,
    jsonrpc: '2.0',
    method: 'tasks/resubscribe',
    params: { id: core.id },
  };
}

/* --------------------------------- PushNotificationConfig RPCs --------------------------------- */

/**
 * v0.3 `SetTaskPushNotificationConfigRequest` → v1.0 proto
 * `TaskPushNotificationConfig` (used as the request body for
 * `CreateTaskPushNotificationConfig`).
 */
export function toCoreCreateTaskPushNotificationConfigRequest(
  compat: legacy.SetTaskPushNotificationConfigRequest
): V1TaskPushNotificationConfig {
  return toCoreTaskPushNotificationConfig(compat.params);
}

/**
 * v1.0 proto `TaskPushNotificationConfig` (create request body) →
 * v0.3 `SetTaskPushNotificationConfigRequest`.
 */
export function toCompatSetTaskPushNotificationConfigRequest(
  core: V1TaskPushNotificationConfig,
  requestId: RequestId
): legacy.SetTaskPushNotificationConfigRequest {
  return {
    id: requestId,
    jsonrpc: '2.0',
    method: 'tasks/pushNotificationConfig/set',
    params: toCompatTaskPushNotificationConfig(core),
  };
}

/** v0.3 `GetTaskPushNotificationConfigRequest` → v1.0 proto request. */
export function toCoreGetTaskPushNotificationConfigRequest(
  compat: legacy.GetTaskPushNotificationConfigRequest
): V1GetTaskPushNotificationConfigRequest {
  const params = compat.params;
  // Both `GetTaskPushNotificationConfigParams` and `TaskIdParams1` carry `id`.
  // The former additionally carries `pushNotificationConfigId`.
  const configId =
    'pushNotificationConfigId' in params ? params.pushNotificationConfigId : undefined;
  return { tenant: '', taskId: params.id, id: configId ?? '' };
}

/** v1.0 proto request → v0.3 `GetTaskPushNotificationConfigRequest`. */
export function toCompatGetTaskPushNotificationConfigRequest(
  core: V1GetTaskPushNotificationConfigRequest,
  requestId: RequestId
): legacy.GetTaskPushNotificationConfigRequest {
  const params: legacy.GetTaskPushNotificationConfigParams | legacy.TaskIdParams1 =
    core.id !== '' ? { id: core.taskId, pushNotificationConfigId: core.id } : { id: core.taskId };
  return {
    id: requestId,
    jsonrpc: '2.0',
    method: 'tasks/pushNotificationConfig/get',
    params,
  };
}

/** v0.3 `DeleteTaskPushNotificationConfigRequest` → v1.0 proto request. */
export function toCoreDeleteTaskPushNotificationConfigRequest(
  compat: legacy.DeleteTaskPushNotificationConfigRequest
): V1DeleteTaskPushNotificationConfigRequest {
  return {
    tenant: '',
    taskId: compat.params.id,
    id: compat.params.pushNotificationConfigId,
  };
}

/** v1.0 proto request → v0.3 `DeleteTaskPushNotificationConfigRequest`. */
export function toCompatDeleteTaskPushNotificationConfigRequest(
  core: V1DeleteTaskPushNotificationConfigRequest,
  requestId: RequestId
): legacy.DeleteTaskPushNotificationConfigRequest {
  return {
    id: requestId,
    jsonrpc: '2.0',
    method: 'tasks/pushNotificationConfig/delete',
    params: { id: core.taskId, pushNotificationConfigId: core.id },
  };
}

/** v0.3 `ListTaskPushNotificationConfigRequest` → v1.0 proto request. */
export function toCoreListTaskPushNotificationConfigsRequest(
  compat: legacy.ListTaskPushNotificationConfigRequest
): V1ListTaskPushNotificationConfigsRequest {
  return { tenant: '', taskId: compat.params.id, pageSize: 0, pageToken: '' };
}

/** v1.0 proto request → v0.3 `ListTaskPushNotificationConfigRequest`. */
export function toCompatListTaskPushNotificationConfigRequest(
  core: V1ListTaskPushNotificationConfigsRequest,
  requestId: RequestId
): legacy.ListTaskPushNotificationConfigRequest {
  return {
    id: requestId,
    jsonrpc: '2.0',
    method: 'tasks/pushNotificationConfig/list',
    params: { id: core.taskId },
  };
}

/* --------------------------------- ListTaskPushNotificationConfigsResponse --------------------------------- */

/** v0.3 list-success response → v1.0 proto `ListTaskPushNotificationConfigsResponse`. */
export function toCoreListTaskPushNotificationConfigsResponse(
  compat: legacy.ListTaskPushNotificationConfigSuccessResponse
): V1ListTaskPushNotificationConfigsResponse {
  return {
    configs: compat.result.map((entry) => toCoreTaskPushNotificationConfig(entry)),
    nextPageToken: '',
  };
}

/** v1.0 proto `ListTaskPushNotificationConfigsResponse` → v0.3 list-success response. */
export function toCompatListTaskPushNotificationConfigSuccessResponse(
  core: V1ListTaskPushNotificationConfigsResponse,
  requestId: ResponseId = null
): legacy.ListTaskPushNotificationConfigSuccessResponse {
  return {
    id: requestId,
    jsonrpc: '2.0',
    result: core.configs.map((cfg) => toCompatTaskPushNotificationConfig(cfg)),
  };
}

/* --------------------------------- GetExtendedAgentCard --------------------------------- */

/** v0.3 `GetAuthenticatedExtendedCardRequest` → v1.0 proto `GetExtendedAgentCardRequest`. */
export function toCoreGetExtendedAgentCardRequest(
  _compat: legacy.GetAuthenticatedExtendedCardRequest
): V1GetExtendedAgentCardRequest {
  return { tenant: '' };
}

/** v1.0 proto `GetExtendedAgentCardRequest` → v0.3 `GetAuthenticatedExtendedCardRequest`. */
export function toCompatGetAuthenticatedExtendedCardRequest(
  _core: V1GetExtendedAgentCardRequest,
  requestId: RequestId
): legacy.GetAuthenticatedExtendedCardRequest {
  return {
    id: requestId,
    jsonrpc: '2.0',
    method: 'agent/getAuthenticatedExtendedCard',
  };
}

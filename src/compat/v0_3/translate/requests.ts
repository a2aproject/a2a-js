/**
 * RPC request/response translators. v0.3 JSON-RPC wraps params under
 * `.params`; v1.0 proto types are flat. Note the polarity inversion:
 * v1.0 `returnImmediately` = `!blocking` in v0.3. v1.0 → v0.3 helpers
 * require an explicit `requestId` since v1.0 proto carries none.
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

export function toCompatSendMessageConfiguration(
  core: V1SendMessageConfiguration
): legacy.MessageSendConfiguration {
  const result: legacy.MessageSendConfiguration = {
    blocking: !core.returnImmediately,
  };
  // Always emit `acceptedOutputModes` (even `[]`). v1.0 collapses
  // absent/empty on the wire, so a round-trip from an explicit `[]`
  // stays stable; the only effect is callers who originally omitted it
  // see `[]` on the return path.
  result.acceptedOutputModes = [...core.acceptedOutputModes];
  if (core.historyLength !== undefined) result.historyLength = core.historyLength;
  if (core.taskPushNotificationConfig) {
    result.pushNotificationConfig = toCompatPushNotificationConfig(core.taskPushNotificationConfig);
  }
  return result;
}

/** v0.3 has no tenants; caller may supply one. Defaults to `''` (global). */
export function toCoreSendMessageRequest(
  compat: legacy.SendMessageRequest | legacy.SendStreamingMessageRequest,
  tenant: string = ''
): V1SendMessageRequest {
  return {
    tenant,
    message: toCoreMessage(compat.params.message),
    configuration: compat.params.configuration
      ? toCoreSendMessageConfiguration(compat.params.configuration)
      : undefined,
    metadata: deepCloneMetadata(compat.params.metadata),
  };
}

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

/** Like `toCompatSendMessageRequest` but with `method: 'message/stream'`. */
export function toCompatSendStreamingMessageRequest(
  core: V1SendMessageRequest,
  requestId: RequestId
): legacy.SendStreamingMessageRequest {
  const inner = toCompatSendMessageRequest(core, requestId);
  return { ...inner, method: 'message/stream' };
}

/** Throws on error envelopes — callers should use typed error classes. */
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

/** Errors are wrapped at the transport layer, not here. */
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

/** Throws on error envelopes — use typed error classes instead. */
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

export function toCoreGetTaskRequest(
  compat: legacy.GetTaskRequest,
  tenant: string = ''
): V1GetTaskRequest {
  return {
    tenant,
    id: compat.params.id,
    historyLength: compat.params.historyLength,
  };
}

export function toCompatGetTaskRequest(
  core: V1GetTaskRequest,
  requestId: RequestId
): legacy.GetTaskRequest {
  const params: legacy.TaskQueryParams = { id: core.id };
  if (core.historyLength !== undefined) params.historyLength = core.historyLength;
  return { id: requestId, jsonrpc: '2.0', method: 'tasks/get', params };
}

export function toCoreCancelTaskRequest(
  compat: legacy.CancelTaskRequest,
  tenant: string = ''
): V1CancelTaskRequest {
  return {
    tenant,
    id: compat.params.id,
    metadata: deepCloneMetadata(compat.params.metadata),
  };
}

export function toCompatCancelTaskRequest(
  core: V1CancelTaskRequest,
  requestId: RequestId
): legacy.CancelTaskRequest {
  const params: legacy.TaskIdParams = { id: core.id };
  const metadata = deepCloneMetadata(core.metadata);
  if (metadata !== undefined) params.metadata = metadata;
  return { id: requestId, jsonrpc: '2.0', method: 'tasks/cancel', params };
}

export function toCoreSubscribeToTaskRequest(
  compat: legacy.TaskResubscriptionRequest,
  tenant: string = ''
): V1SubscribeToTaskRequest {
  return { tenant, id: compat.params.id };
}

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

export function toCoreCreateTaskPushNotificationConfigRequest(
  compat: legacy.SetTaskPushNotificationConfigRequest,
  tenant: string = ''
): V1TaskPushNotificationConfig {
  return toCoreTaskPushNotificationConfig(compat.params, tenant);
}

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

export function toCoreGetTaskPushNotificationConfigRequest(
  compat: legacy.GetTaskPushNotificationConfigRequest,
  tenant: string = ''
): V1GetTaskPushNotificationConfigRequest {
  const params = compat.params;
  // Both shapes carry `id`; only the former carries `pushNotificationConfigId`.
  const configId =
    'pushNotificationConfigId' in params ? params.pushNotificationConfigId : undefined;
  return { tenant, taskId: params.id, id: configId ?? '' };
}

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

export function toCoreDeleteTaskPushNotificationConfigRequest(
  compat: legacy.DeleteTaskPushNotificationConfigRequest,
  tenant: string = ''
): V1DeleteTaskPushNotificationConfigRequest {
  return {
    tenant,
    taskId: compat.params.id,
    id: compat.params.pushNotificationConfigId,
  };
}

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

export function toCoreListTaskPushNotificationConfigsRequest(
  compat: legacy.ListTaskPushNotificationConfigRequest,
  tenant: string = ''
): V1ListTaskPushNotificationConfigsRequest {
  return { tenant, taskId: compat.params.id, pageSize: 0, pageToken: '' };
}

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

export function toCoreListTaskPushNotificationConfigsResponse(
  compat: legacy.ListTaskPushNotificationConfigSuccessResponse
): V1ListTaskPushNotificationConfigsResponse {
  return {
    configs: compat.result.map((entry) => toCoreTaskPushNotificationConfig(entry)),
    nextPageToken: '',
  };
}

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

export function toCoreGetExtendedAgentCardRequest(
  _compat: legacy.GetAuthenticatedExtendedCardRequest,
  tenant: string = ''
): V1GetExtendedAgentCardRequest {
  return { tenant };
}

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

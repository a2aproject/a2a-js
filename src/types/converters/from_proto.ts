import { A2AError } from '../../server/error.js';
import {
  CreateTaskPushNotificationConfigRequest,
  Message,
  SendMessageResponse,
  Task,
  TaskPushNotificationConfig,
  ListTaskPushNotificationConfigResponse,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  StreamResponse,
} from '../pb/a2a_types.js';
import { extractTaskId } from './id_decoding.js';

/**
 * Converts proto types to internal types.
 * Since we now use proto types as source of truth, this class is mostly an identity mapper
 * or handles minor structural differences if any legacy support is needed. Planned to be removed completely in the future.
 */
export class FromProto {
  static createTaskPushNotificationConfig(
    request: CreateTaskPushNotificationConfigRequest
  ): TaskPushNotificationConfig {
    if (!request.config || !request.config.pushNotificationConfig) {
      throw A2AError.invalidParams(
        'Request must include a `config` with `pushNotificationConfig`'
      );
    }
    return {
      name: `tasks/${extractTaskId(request.parent)}/pushNotificationConfigs/${request.config.pushNotificationConfig.id}`,
      pushNotificationConfig: request.config.pushNotificationConfig,
    };
  }

  static sendMessageResult(response: SendMessageResponse): Task | Message {
    if (response.payload?.$case === 'task') {
      return response.payload.value;
    } else if (response.payload?.$case === 'msg') {
      return response.payload.value;
    }
    throw A2AError.invalidParams('Invalid SendMessageResponse: missing result');
  }

  static listTaskPushNotificationConfig(
    request: ListTaskPushNotificationConfigResponse
  ): TaskPushNotificationConfig[] {
    return request.configs;
  }

  static messageStreamResult(
    event: StreamResponse
  ): Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent {
    if (event.payload) {
      return event.payload.value;
    }
    throw A2AError.internalError('Invalid event type in StreamResponse');
  }
}

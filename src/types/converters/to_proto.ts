import { A2AError } from '../../server/error.js';
import {
  Message,
  PushNotificationConfig,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskPushNotificationConfig,
  TaskStatusUpdateEvent,
  ListTaskPushNotificationConfigResponse,
} from '../pb/a2a_types.js';
import { generatePushNotificationConfigName } from './id_decoding.js';

export class ToProto {
  static listTaskPushNotificationConfig(
    configs: (
      | { taskId: string; pushNotificationConfig: PushNotificationConfig }
      | TaskPushNotificationConfig
    )[]
  ): ListTaskPushNotificationConfigResponse {
    return {
      configs: configs.map((c) => {
        if ('taskId' in c) {
          return {
            name: generatePushNotificationConfigName(c.taskId, c.pushNotificationConfig.id),
            pushNotificationConfig: c.pushNotificationConfig,
          };
        }
        return c;
      }),
      nextPageToken: '',
    };
  }

  static taskPushNotificationConfig(
    config:
      | { taskId: string; pushNotificationConfig: PushNotificationConfig }
      | TaskPushNotificationConfig
  ): TaskPushNotificationConfig {
    if ('taskId' in config) {
      return {
        name: generatePushNotificationConfigName(config.taskId, config.pushNotificationConfig.id),
        pushNotificationConfig: config.pushNotificationConfig,
      };
    }
    return config;
  }

  static messageStreamResult(
    event: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent
  ): StreamResponse {
    if ('messageId' in event) {
      return {
        payload: {
          $case: 'msg',
          value: event,
        },
      };
    } else if ('artifacts' in event) {
      return {
        payload: {
          $case: 'task',
          value: event,
        },
      };
    } else if ('status' in event) {
      return {
        payload: {
          $case: 'statusUpdate',
          value: event,
        },
      };
    } else if ('artifact' in event) {
      return {
        payload: {
          $case: 'artifactUpdate',
          value: event,
        },
      };
    }
    throw A2AError.internalError('Invalid event type');
  }

  static messageSendResult(params: Message | Task): SendMessageResponse {
    if ('messageId' in params) {
      return {
        payload: {
          $case: 'msg',
          value: params,
        },
      };
    } else if ('artifacts' in params) {
      return {
        payload: {
          $case: 'task',
          value: params,
        },
      };
    }
  }
}

import { GenericError } from '../../errors.js';
import {
  Message,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskPushNotificationConfig,
  TaskStatusUpdateEvent,
  ListTaskPushNotificationConfigsResponse,
} from '../pb/a2a.js';

export class ToProto {
  static listTaskPushNotificationConfig(
    configs: TaskPushNotificationConfig[]
  ): ListTaskPushNotificationConfigsResponse {
    return {
      configs,
      nextPageToken: '',
    };
  }

  static messageStreamResult(
    event: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent
  ): StreamResponse {
    if ('messageId' in event) {
      return {
        payload: {
          $case: 'message',
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
    throw new GenericError('Invalid event type');
  }

  static messageSendResult(params: Message | Task): SendMessageResponse {
    if ('messageId' in params) {
      return {
        payload: {
          $case: 'message',
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

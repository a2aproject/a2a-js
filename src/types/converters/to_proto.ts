import { GenericError } from '../../errors.js';
import {
  Message,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
} from '../pb/a2a.js';

export class ToProto {
  static messageStreamResult(
    event: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent | StreamResponse
  ): StreamResponse {
    if (event && typeof event === 'object' && 'payload' in event) {
      return event as StreamResponse;
    }
    if ('messageId' in event) {
      return {
        payload: {
          $case: 'message',
          value: event as Message,
        },
      };
    } else if ('artifacts' in event) {
      return {
        payload: {
          $case: 'task',
          value: event as Task,
        },
      };
    } else if ('status' in event) {
      return {
        payload: {
          $case: 'statusUpdate',
          value: event as TaskStatusUpdateEvent,
        },
      };
    } else if ('artifact' in event) {
      return {
        payload: {
          $case: 'artifactUpdate',
          value: event as TaskArtifactUpdateEvent,
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
    throw new GenericError('Invalid SendMessageResult type');
  }
}

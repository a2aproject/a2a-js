import { GenericError } from '../../errors.js';
import {
  Message,
  SendMessageResponse,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  StreamResponse,
} from '../pb/a2a.js';

/**
 * Converts proto types to internal types.
 * Since we now use proto types as source of truth, this class is mostly an identity mapper
 * or handles minor structural differences if any legacy support is needed. Planned to be removed completely in the future.
 */
export class FromProto {
  static sendMessageResult(response: SendMessageResponse): Task | Message {
    if (response.payload?.$case === 'task') {
      return response.payload.value;
    } else if (response.payload?.$case === 'message') {
      return response.payload.value;
    }
    throw new GenericError('Invalid SendMessageResponse: missing result');
  }

  static messageStreamResult(
    event: StreamResponse
  ): Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent {
    if (event.payload) {
      return event.payload.value;
    }
    throw new GenericError('Invalid event type in StreamResponse');
  }
}

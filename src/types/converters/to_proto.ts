import { GenericError } from '../../errors.js';
import { Message, SendMessageResponse, Task } from '../pb/a2a.js';

export class ToProto {
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

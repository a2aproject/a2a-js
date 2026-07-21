import { A2AError } from '../../errors/index.js';
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
    throw new A2AError('Invalid SendMessageResult type');
  }
}

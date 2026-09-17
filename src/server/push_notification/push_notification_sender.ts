import { StreamResponse, Task } from '../../index.js';
import { ServerCallContext } from '../context.js';

export interface PushNotificationSender {
  send(streamResponse: StreamResponse, context: ServerCallContext, task?: Task): Promise<void>;
}

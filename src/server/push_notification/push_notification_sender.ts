import { Task } from '../../index.js';
import { ServerCallContext } from '../context.js';

export interface PushNotificationSender {
  send(task: Task, context: ServerCallContext): Promise<void>;
}

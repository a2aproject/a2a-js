import { Task } from '../../types.js';

export interface PushNotificationSender {
  send(task: Task): Promise<void>;
}

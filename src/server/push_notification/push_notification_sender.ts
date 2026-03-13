import { Task } from '../../index.js';

export interface PushNotificationSender {
  send(task: Task): Promise<void>;
}

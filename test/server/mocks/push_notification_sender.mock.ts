import { vi, type Mock } from 'vitest';
import { Task } from '../../../src/index.js';
import { PushNotificationSender } from '../../../src/server/push_notification/push_notification_sender.js';

export class MockPushNotificationSender implements PushNotificationSender {
  public send: Mock<(task: Task) => Promise<void>> = vi.fn();
}

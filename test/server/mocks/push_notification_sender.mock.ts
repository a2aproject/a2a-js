import { vi, type Mock } from 'vitest';
import { StreamResponse } from '../../../src/types/pb/a2a.js';
import { PushNotificationSender } from '../../../src/server/push_notification/push_notification_sender.js';
import { ServerCallContext } from '../../../src/server/context.js';

export class MockPushNotificationSender implements PushNotificationSender {
  public send: Mock<(streamResponse: StreamResponse, context: ServerCallContext) => Promise<void>> =
    vi.fn();
}

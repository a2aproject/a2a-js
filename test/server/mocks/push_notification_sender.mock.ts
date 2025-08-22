import sinon, { SinonStub } from 'sinon';
import { Task } from '../../../src/index.js';
import { PushNotificationSender } from '../../../src/server/push_notification/push_notification_sender.js';

export class MockPushNotificationSender implements PushNotificationSender {
    public send: SinonStub<[Task], Promise<void>> = sinon.stub();
}
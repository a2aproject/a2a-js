import { describe, it, beforeEach, expect, vi, Mock } from 'vitest';
import { TenantTransportDecorator } from '../../../src/client/transports/tenant_transport_decorator.js';
import { Transport } from '../../../src/client/transports/transport.js';
import { SendMessageRequest } from '../../../src/types/pb/a2a.js';

/** Drains an async generator to completion. */
async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  while (!(await gen.next()).done) {
    // consume all values
  }
}

describe('TenantTransportDecorator', () => {
  const DEFAULT_TENANT = 'default-tenant';
  let mockTransport: Record<Exclude<keyof Transport, 'protocolName'>, Mock> & {
    protocolName: string;
  };
  let decorator: TenantTransportDecorator;

  beforeEach(() => {
    mockTransport = {
      getExtendedAgentCard: vi.fn().mockResolvedValue({}),
      sendMessage: vi.fn().mockResolvedValue({}),
      sendMessageStream: vi.fn().mockReturnValue((async function* () {})()),
      createTaskPushNotificationConfig: vi.fn().mockResolvedValue({}),
      getTaskPushNotificationConfig: vi.fn().mockResolvedValue({}),
      listTaskPushNotificationConfig: vi.fn().mockResolvedValue({ configs: [] }),
      deleteTaskPushNotificationConfig: vi.fn().mockResolvedValue(undefined),
      getTask: vi.fn().mockResolvedValue({}),
      cancelTask: vi.fn().mockResolvedValue({}),
      listTasks: vi.fn().mockResolvedValue({ tasks: [] }),
      resubscribeTask: vi.fn().mockReturnValue((async function* () {})()),
      protocolName: 'MockTransport',
    };
    decorator = new TenantTransportDecorator(mockTransport, DEFAULT_TENANT);
  });

  it('should expose the base transport protocol name', () => {
    expect(decorator.protocolName).to.equal('MockTransport');
  });

  describe('default tenant application', () => {
    it('should apply default tenant to sendMessage when tenant is empty', async () => {
      await decorator.sendMessage({
        tenant: '',
        message: undefined,
        configuration: undefined,
        metadata: {},
      });

      const passedParams = mockTransport.sendMessage.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should preserve caller-specified tenant on sendMessage', async () => {
      await decorator.sendMessage({
        tenant: 'custom-tenant',
        message: undefined,
        configuration: undefined,
        metadata: {},
      });

      const passedParams = mockTransport.sendMessage.mock.calls[0][0];
      expect(passedParams.tenant).to.equal('custom-tenant');
    });

    it('should apply default tenant to getExtendedAgentCard when tenant is empty', async () => {
      await decorator.getExtendedAgentCard({ tenant: '' });

      const passedParams = mockTransport.getExtendedAgentCard.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should apply default tenant to getTask when tenant is empty', async () => {
      await decorator.getTask({ id: 'task-1', tenant: '', historyLength: 0 });

      const passedParams = mockTransport.getTask.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should preserve caller-specified tenant on getTask', async () => {
      await decorator.getTask({ id: 'task-1', tenant: 'override', historyLength: 0 });

      const passedParams = mockTransport.getTask.mock.calls[0][0];
      expect(passedParams.tenant).to.equal('override');
    });

    it('should apply default tenant to cancelTask when tenant is empty', async () => {
      await decorator.cancelTask({ id: 'task-1', tenant: '', metadata: {} });

      const passedParams = mockTransport.cancelTask.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should apply default tenant to listTasks when tenant is empty', async () => {
      await decorator.listTasks({
        tenant: '',
        contextId: '',
        status: undefined,
        pageToken: '',
        statusTimestampAfter: '',
      });

      const passedParams = mockTransport.listTasks.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should apply default tenant to createTaskPushNotificationConfig when tenant is empty', async () => {
      await decorator.createTaskPushNotificationConfig({
        tenant: '',
        id: 'config-1',
        taskId: 'task-1',
        url: 'https://example.com',
        token: '',
        authentication: undefined,
      });

      const passedParams = mockTransport.createTaskPushNotificationConfig.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should apply default tenant to getTaskPushNotificationConfig when tenant is empty', async () => {
      await decorator.getTaskPushNotificationConfig({ id: 'cfg-1', taskId: 'task-1', tenant: '' });

      const passedParams = mockTransport.getTaskPushNotificationConfig.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should apply default tenant to listTaskPushNotificationConfig when tenant is empty', async () => {
      await decorator.listTaskPushNotificationConfig({
        taskId: 'task-1',
        tenant: '',
        pageSize: 0,
        pageToken: '',
      });

      const passedParams = mockTransport.listTaskPushNotificationConfig.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should apply default tenant to deleteTaskPushNotificationConfig when tenant is empty', async () => {
      await decorator.deleteTaskPushNotificationConfig({
        id: 'cfg-1',
        taskId: 'task-1',
        tenant: '',
      });

      const passedParams = mockTransport.deleteTaskPushNotificationConfig.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should apply default tenant to sendMessageStream when tenant is empty', async () => {
      await drain(
        decorator.sendMessageStream({
          tenant: '',
          message: undefined,
          configuration: undefined,
          metadata: {},
        })
      );

      const passedParams = mockTransport.sendMessageStream.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should apply default tenant to resubscribeTask when tenant is empty', async () => {
      await drain(decorator.resubscribeTask({ id: 'task-1', tenant: '' }));

      const passedParams = mockTransport.resubscribeTask.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });
  });

  describe('caller-specified tenant preservation', () => {
    const CALLER_TENANT = 'caller-tenant';

    it('should preserve caller-specified tenant on getExtendedAgentCard', async () => {
      await decorator.getExtendedAgentCard({ tenant: CALLER_TENANT });

      const passedParams = mockTransport.getExtendedAgentCard.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(CALLER_TENANT);
    });

    it('should preserve caller-specified tenant on cancelTask', async () => {
      await decorator.cancelTask({ id: 'task-1', tenant: CALLER_TENANT, metadata: {} });

      const passedParams = mockTransport.cancelTask.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(CALLER_TENANT);
    });

    it('should preserve caller-specified tenant on listTasks', async () => {
      await decorator.listTasks({
        tenant: CALLER_TENANT,
        contextId: '',
        status: undefined,
        pageToken: '',
        statusTimestampAfter: '',
      });

      const passedParams = mockTransport.listTasks.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(CALLER_TENANT);
    });

    it('should preserve caller-specified tenant on createTaskPushNotificationConfig', async () => {
      await decorator.createTaskPushNotificationConfig({
        tenant: CALLER_TENANT,
        id: 'config-1',
        taskId: 'task-1',
        url: 'https://example.com',
        token: '',
        authentication: undefined,
      });

      const passedParams = mockTransport.createTaskPushNotificationConfig.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(CALLER_TENANT);
    });

    it('should preserve caller-specified tenant on getTaskPushNotificationConfig', async () => {
      await decorator.getTaskPushNotificationConfig({
        id: 'cfg-1',
        taskId: 'task-1',
        tenant: CALLER_TENANT,
      });

      const passedParams = mockTransport.getTaskPushNotificationConfig.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(CALLER_TENANT);
    });

    it('should preserve caller-specified tenant on listTaskPushNotificationConfig', async () => {
      await decorator.listTaskPushNotificationConfig({
        taskId: 'task-1',
        tenant: CALLER_TENANT,
        pageSize: 0,
        pageToken: '',
      });

      const passedParams = mockTransport.listTaskPushNotificationConfig.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(CALLER_TENANT);
    });

    it('should preserve caller-specified tenant on deleteTaskPushNotificationConfig', async () => {
      await decorator.deleteTaskPushNotificationConfig({
        id: 'cfg-1',
        taskId: 'task-1',
        tenant: CALLER_TENANT,
      });

      const passedParams = mockTransport.deleteTaskPushNotificationConfig.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(CALLER_TENANT);
    });

    it('should preserve caller-specified tenant on sendMessageStream', async () => {
      await drain(
        decorator.sendMessageStream({
          tenant: CALLER_TENANT,
          message: undefined,
          configuration: undefined,
          metadata: {},
        })
      );

      const passedParams = mockTransport.sendMessageStream.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(CALLER_TENANT);
    });

    it('should preserve caller-specified tenant on resubscribeTask', async () => {
      await drain(
        decorator.resubscribeTask({
          id: 'task-1',
          tenant: CALLER_TENANT,
        })
      );

      const passedParams = mockTransport.resubscribeTask.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(CALLER_TENANT);
    });
  });

  describe('other fields passthrough', () => {
    it('should not mutate the original params object', async () => {
      const params: SendMessageRequest = {
        tenant: '',
        message: undefined,
        configuration: undefined,
        metadata: { key: 'value' },
      };
      const original = { ...params };
      await decorator.sendMessage(params);

      // Original object should be unchanged
      expect(params).to.deep.equal(original);
      // But the base transport received the resolved tenant
      const passedParams = mockTransport.sendMessage.mock.calls[0][0];
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });

    it('should forward all non-tenant fields unchanged', async () => {
      await decorator.getTask({ id: 'my-task', tenant: '', historyLength: 42 });

      const passedParams = mockTransport.getTask.mock.calls[0][0];
      expect(passedParams.id).to.equal('my-task');
      expect(passedParams.historyLength).to.equal(42);
      expect(passedParams.tenant).to.equal(DEFAULT_TENANT);
    });
  });

  it('should pass through RequestOptions to the base transport', async () => {
    const options = { signal: new AbortController().signal };
    await decorator.sendMessage(
      { tenant: '', message: undefined, configuration: undefined, metadata: {} },
      options
    );

    expect(mockTransport.sendMessage.mock.calls[0][1]).to.equal(options);
  });
});

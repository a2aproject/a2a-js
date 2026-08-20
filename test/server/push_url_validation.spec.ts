import { describe, it, expect, vi } from 'vitest';

import {
  isBlockedPushIp,
  pushUrlValidationError,
} from '../../src/server/push_notification/push_url_validation.js';
import { DefaultPushNotificationSender } from '../../src/server/push_notification/default_push_notification_sender.js';
import { InMemoryPushNotificationStore } from '../../src/server/push_notification/push_notification_store.js';
import { ServerCallContext } from '../../src/server/context.js';
import { AgentCard, StreamResponse, Task, TaskState } from '../../src/types/pb/a2a.js';
import { A2A_PROTOCOL_VERSION } from '../../src/constants.js';
import { DefaultRequestHandler } from '../../src/server/request_handler/default_request_handler.js';
import { InMemoryTaskStore } from '../../src/server/store.js';
import { DefaultExecutionEventBusManager } from '../../src/server/events/execution_event_bus_manager.js';
import { MockAgentExecutor } from './mocks/agent-executor.mock.js';

describe('isBlockedPushIp', () => {
  it('blocks loopback, private, link-local, CGNAT, benchmarking, multicast', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '::1',
      '::',
      '::ffff:127.0.0.1',
      'fe80::1',
      'fc00::1',
    ]) {
      expect(isBlockedPushIp(ip), ip).toBe(true);
    }
  });

  it('allows public unicast', () => {
    expect(isBlockedPushIp('8.8.8.8')).toBe(false);
    expect(isBlockedPushIp('1.1.1.1')).toBe(false);
  });
});

describe('pushUrlValidationError', () => {
  it('rejects non-http schemes', async () => {
    expect(await pushUrlValidationError('file:///etc/passwd')).toMatch(/scheme/);
    expect(await pushUrlValidationError('ftp://example.com')).toMatch(/scheme/);
  });

  it('rejects literal private IPs', async () => {
    expect(await pushUrlValidationError('http://127.0.0.1/hook')).toMatch(/non-public/);
    expect(await pushUrlValidationError('http://169.254.169.254/latest/meta-data/')).toMatch(
      /non-public/
    );
    expect(await pushUrlValidationError('http://100.64.0.1/hook')).toMatch(/non-public/);
  });

  it('allows public https hosts', async () => {
    expect(await pushUrlValidationError('https://example.com/hook')).toBeUndefined();
  });
});

describe('DefaultPushNotificationSender SSRF guard', () => {
  it('drops private targets by default (does not fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const store = new InMemoryPushNotificationStore();
    const sender = new DefaultPushNotificationSender(store);
    const ctx = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save('task-ssrf', ctx, {
      tenant: '',
      taskId: 'task-ssrf',
      id: 'cfg',
      url: 'http://127.0.0.1:9/hook',
      token: '',
      authentication: undefined,
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sender.send(
      {
        payload: {
          $case: 'statusUpdate',
          value: {
            taskId: 'task-ssrf',
            contextId: 'ctx',
            status: {
              state: TaskState.TASK_STATE_WORKING,
              message: undefined,
              timestamp: '2026-08-11T00:00:00Z',
            },
            metadata: {},
          },
        },
      } satisfies StreamResponse,
      ctx
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    fetchSpy.mockRestore();
    warn.mockRestore();
  });

  it('revert-test: allowPrivatePushUrls true would call fetch for loopback', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    const store = new InMemoryPushNotificationStore();
    const sender = new DefaultPushNotificationSender(store, { allowPrivatePushUrls: true });
    const ctx = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save('task-ok', ctx, {
      tenant: '',
      taskId: 'task-ok',
      id: 'cfg',
      url: 'http://127.0.0.1:9/hook',
      token: '',
      authentication: undefined,
    });

    await sender.send(
      {
        payload: {
          $case: 'statusUpdate',
          value: {
            taskId: 'task-ok',
            contextId: 'ctx',
            status: {
              state: TaskState.TASK_STATE_WORKING,
              message: undefined,
              timestamp: '2026-08-11T00:00:00Z',
            },
            metadata: {},
          },
        },
      } satisfies StreamResponse,
      ctx
    );

    expect(fetchSpy).toHaveBeenCalled();
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    fetchSpy.mockRestore();
  });
});

describe('create-time push URL validation', () => {
  const agentCard: AgentCard = {
    name: 'Push Agent',
    description: 'test',
    version: '1.0.0',
    provider: undefined,
    documentationUrl: '',
    supportedInterfaces: [
      { url: 'http://localhost/a2a', protocolBinding: 'HTTP+JSON', tenant: '', protocolVersion: '1.0' },
    ],
    capabilities: { extensions: [], streaming: true, pushNotifications: true },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };

  it('rejects private URLs on createTaskPushNotificationConfig', async () => {
    const taskStore = new InMemoryTaskStore();
    const pushStore = new InMemoryPushNotificationStore();
    const handler = new DefaultRequestHandler(
      agentCard,
      taskStore,
      new MockAgentExecutor(),
      new DefaultExecutionEventBusManager(),
      pushStore
    );
    const ctx = new ServerCallContext();
    const taskId = 't-create';
    await taskStore.save(
      {
        id: taskId,
        contextId: 'c',
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      } satisfies Task,
      ctx
    );

    await expect(
      handler.createTaskPushNotificationConfig(
        {
          tenant: '',
          taskId,
          id: '',
          url: 'http://169.254.169.254/latest/meta-data/',
          token: '',
          authentication: undefined,
        },
        ctx
      )
    ).rejects.toThrow(/invalid push config endpoint URL/);
  });
});

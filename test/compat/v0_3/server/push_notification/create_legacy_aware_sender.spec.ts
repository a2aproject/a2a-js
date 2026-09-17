import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Request, Response } from 'express';
import { Server } from 'http';
import { AddressInfo } from 'net';

import {
  createLegacyAwarePushNotificationSender,
  V03PushNotificationSerializer,
} from '../../../../../src/compat/v0_3/server/push_notification/index.js';
import { InMemoryPushNotificationStore } from '../../../../../src/server/push_notification/push_notification_store.js';
import { ServerCallContext } from '../../../../../src/server/context.js';
import {
  StreamResponse,
  TaskPushNotificationConfig,
  TaskState,
} from '../../../../../src/types/pb/a2a.js';
import { A2A_LEGACY_PROTOCOL_VERSION, A2A_PROTOCOL_VERSION } from '../../../../../src/constants.js';
import {
  PushNotificationSerializer,
  SerializedPushNotification,
} from '../../../../../src/server/push_notification/push_notification_serializer.js';

type Captured = { body: any; rawBody: string; headers: Record<string, string | undefined> };

describe('createLegacyAwarePushNotificationSender', () => {
  let received: Captured[];
  let server: Server;
  let url: string;
  let store: InMemoryPushNotificationStore;

  beforeEach(async () => {
    received = [];
    store = new InMemoryPushNotificationStore();
    const app = express();
    app.use(express.text({ type: '*/*' }));
    app.post('/notify', (req: Request, res: Response) => {
      const rawBody = typeof req.body === 'string' ? req.body : '';
      received.push({
        body: rawBody ? JSON.parse(rawBody) : undefined,
        rawBody,
        headers: req.headers as Record<string, string | undefined>,
      });
      res.status(200).json({ ok: true });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        url = `http://127.0.0.1:${port}/notify`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  function makeConfig(): TaskPushNotificationConfig {
    return {
      tenant: '',
      taskId: '',
      id: 'cfg-1',
      url,
      token: '',
      authentication: undefined,
    };
  }

  function makeStatusUpdate(taskId: string): StreamResponse {
    return {
      payload: {
        $case: 'statusUpdate',
        value: {
          taskId,
          contextId: 'ctx',
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: '2026-04-15T14:00:00Z',
          },
          metadata: {},
        },
      },
    };
  }

  it('pre-registers the V03 serializer under the legacy version key', async () => {
    const sender = createLegacyAwarePushNotificationSender(store);
    const ctxV03 = new ServerCallContext({ requestedVersion: A2A_LEGACY_PROTOCOL_VERSION });
    await store.save('task-v03', ctxV03, makeConfig());

    await sender.send(makeStatusUpdate('task-v03'), ctxV03);

    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toBe('application/json');
    // Body should be the bare event object (V03 shape), not wrapped.
    expect(received[0].body.kind).toBe('status-update');
    expect(received[0].body).not.toHaveProperty('jsonrpc');
    expect(received[0].body).not.toHaveProperty('statusUpdate');
  });

  it('still uses the v1.0 serializer for v1.0-tagged configs', async () => {
    const sender = createLegacyAwarePushNotificationSender(store);
    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save('task-v1', ctxV1, makeConfig());

    await sender.send(makeStatusUpdate('task-v1'), ctxV1);

    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toBe('application/a2a+json');
    // v1.0 body is the wrapped StreamResponse.
    expect(received[0].body).toHaveProperty('statusUpdate');
  });

  it('lets user-supplied serializers[0.3] override the pre-registered V03 serializer', async () => {
    const customV03: PushNotificationSerializer = {
      serialize(): SerializedPushNotification {
        return { body: '"custom-v03-body"', contentType: 'application/x-custom' };
      },
    };
    const sender = createLegacyAwarePushNotificationSender(store, {
      serializers: { [A2A_LEGACY_PROTOCOL_VERSION]: customV03 },
    });
    const ctxV03 = new ServerCallContext({ requestedVersion: A2A_LEGACY_PROTOCOL_VERSION });
    await store.save('task-override', ctxV03, makeConfig());

    await sender.send(makeStatusUpdate('task-override'), ctxV03);

    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toBe('application/x-custom');
    expect(received[0].rawBody).toBe('"custom-v03-body"');
  });

  it('passes other options (timeout, tokenHeaderName) through', async () => {
    const sender = createLegacyAwarePushNotificationSender(store, {
      tokenHeaderName: 'X-My-Token',
    });
    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    const cfg = makeConfig();
    cfg.token = 'shh';
    await store.save('task-opt', ctxV1, cfg);

    await sender.send(makeStatusUpdate('task-opt'), ctxV1);

    expect(received).toHaveLength(1);
    expect(received[0].headers['x-my-token']).toBe('shh');
    expect(received[0].headers['x-a2a-notification-token']).toBeUndefined();
  });

  it('exposes V03PushNotificationSerializer alongside the helper', () => {
    expect(typeof V03PushNotificationSerializer).toBe('function');
    expect(new V03PushNotificationSerializer().serialize).toBeTypeOf('function');
  });
});

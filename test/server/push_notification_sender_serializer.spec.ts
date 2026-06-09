import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Server } from 'http';
import { AddressInfo } from 'net';
import express, { Request, Response } from 'express';

import { DefaultPushNotificationSender } from '../../src/server/push_notification/default_push_notification_sender.js';
import {
  InMemoryPushNotificationStore,
  PushNotificationStore,
} from '../../src/server/push_notification/push_notification_store.js';
import {
  PushNotificationSerializer,
  SerializedPushNotification,
  V1PushNotificationSerializer,
} from '../../src/server/push_notification/push_notification_serializer.js';
import { ServerCallContext } from '../../src/server/context.js';
import {
  Role,
  StreamResponse,
  TaskPushNotificationConfig,
  TaskState,
} from '../../src/types/pb/a2a.js';
import {
  A2A_CONTENT_TYPE,
  A2A_LEGACY_PROTOCOL_VERSION,
  A2A_PROTOCOL_VERSION,
  ProtocolVersion,
} from '../../src/constants.js';

type Captured = {
  body: any;
  rawBody: string;
  headers: Record<string, string | undefined>;
  url: string;
};

function makeStatusUpdate(taskId: string, contextId = 'ctx-test'): StreamResponse {
  return {
    payload: {
      $case: 'statusUpdate',
      value: {
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          message: undefined,
          timestamp: '2026-04-15T14:00:00Z',
        },
        metadata: {},
      },
    },
  };
}

function makeMessage(taskId: string): StreamResponse {
  return {
    payload: {
      $case: 'message',
      value: {
        messageId: 'm-1',
        role: Role.ROLE_AGENT,
        parts: [],
        contextId: 'ctx-test',
        taskId,
        extensions: [],
        metadata: {},
        referenceTaskIds: [],
      },
    },
  };
}

function makeConfig(
  url: string,
  overrides: Partial<TaskPushNotificationConfig> = {}
): TaskPushNotificationConfig {
  return {
    tenant: '',
    taskId: '',
    id: 'cfg-1',
    url,
    token: '',
    authentication: undefined,
    ...overrides,
  };
}

describe('DefaultPushNotificationSender serializer registry', () => {
  let received: Captured[];
  let server: Server;
  let baseUrl: string;
  let store: InMemoryPushNotificationStore;

  beforeEach(async () => {
    received = [];
    store = new InMemoryPushNotificationStore();
    const app = express();
    // Accept both v1.0 and v0.3 content types so the test webhook can decode
    // either format.
    app.use(express.text({ type: '*/*' }));
    app.post('/notify', (req: Request, res: Response) => {
      const rawBody = typeof req.body === 'string' ? req.body : '';
      received.push({
        body: rawBody ? JSON.parse(rawBody) : undefined,
        rawBody,
        headers: req.headers as Record<string, string | undefined>,
        url: req.url,
      });
      res.status(200).json({ ok: true });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    vi.restoreAllMocks();
  });

  it('uses the built-in v1.0 serializer for v1.0-tagged configs (regression)', async () => {
    const sender = new DefaultPushNotificationSender(store);
    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save('task-v1', ctxV1, makeConfig(`${baseUrl}/notify`));

    await sender.send(makeStatusUpdate('task-v1'), ctxV1);

    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toBe(A2A_CONTENT_TYPE);
    expect(received[0].body).toEqual(StreamResponse.toJSON(makeStatusUpdate('task-v1')));
  });

  it('routes to a custom serializer registered for a non-default wire version', async () => {
    const v03Serializer: PushNotificationSerializer = {
      serialize(): SerializedPushNotification {
        return { body: '{"kind":"task","fake":"v0.3-body"}', contentType: 'application/json' };
      },
    };
    const sender = new DefaultPushNotificationSender(store, {
      serializers: { [A2A_LEGACY_PROTOCOL_VERSION]: v03Serializer },
    });
    const ctxV03 = new ServerCallContext({ requestedVersion: A2A_LEGACY_PROTOCOL_VERSION });
    await store.save('task-v03', ctxV03, makeConfig(`${baseUrl}/notify`));

    await sender.send(makeStatusUpdate('task-v03'), ctxV03);

    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toBe('application/json');
    expect(received[0].body).toEqual({ kind: 'task', fake: 'v0.3-body' });
  });

  it('uses the right serializer per stored entry when configs on one task have mixed versions', async () => {
    const v03Serializer: PushNotificationSerializer = {
      serialize(): SerializedPushNotification {
        return { body: '{"v":"0.3"}', contentType: 'application/json' };
      },
    };
    const sender = new DefaultPushNotificationSender(store, {
      serializers: { [A2A_LEGACY_PROTOCOL_VERSION]: v03Serializer },
    });

    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    const ctxV03 = new ServerCallContext({ requestedVersion: A2A_LEGACY_PROTOCOL_VERSION });

    await store.save('task-mix', ctxV1, makeConfig(`${baseUrl}/notify`, { id: 'v1-cfg' }));
    await store.save('task-mix', ctxV03, makeConfig(`${baseUrl}/notify`, { id: 'v03-cfg' }));

    await sender.send(makeStatusUpdate('task-mix'), ctxV1);

    expect(received).toHaveLength(2);
    const bodies = received.map((r) => r.rawBody).sort();
    expect(bodies).toContain('{"v":"0.3"}');
    expect(bodies.some((b) => b.includes('"statusUpdate"'))).toBe(true);
  });

  it('falls back to the v1.0 serializer with a one-time warning for unknown wire versions', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sender = new DefaultPushNotificationSender(store);
    // Register two configs under an unknown wire version on the same task so
    // we can verify the warning is emitted only once per instance per
    // unknown version.
    const ctxUnknown = new ServerCallContext({ requestedVersion: '99.99' });
    await store.save('task-unknown', ctxUnknown, makeConfig(`${baseUrl}/notify`, { id: 'cfg-a' }));
    await store.save('task-unknown', ctxUnknown, makeConfig(`${baseUrl}/notify`, { id: 'cfg-b' }));

    await sender.send(makeStatusUpdate('task-unknown'), ctxUnknown);

    expect(received).toHaveLength(2);
    // Both dispatches must produce v1.0 bodies.
    for (const r of received) {
      expect(r.headers['content-type']).toBe(A2A_CONTENT_TYPE);
    }
    // Only one warning despite two missing-serializer lookups.
    const matching = warn.mock.calls.filter((args) =>
      String(args[0]).includes("wire version '99.99'")
    );
    expect(matching).toHaveLength(1);
  });

  it('user-supplied serializers[1.0] override the built-in v1.0 serializer', async () => {
    const customV1: PushNotificationSerializer = {
      serialize(): SerializedPushNotification {
        return { body: '"custom-v1-body"', contentType: 'application/custom' };
      },
    };
    const sender = new DefaultPushNotificationSender(store, {
      serializers: { [A2A_PROTOCOL_VERSION]: customV1 },
    });
    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save('task-override', ctxV1, makeConfig(`${baseUrl}/notify`));

    await sender.send(makeStatusUpdate('task-override'), ctxV1);

    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toBe('application/custom');
    expect(received[0].rawBody).toBe('"custom-v1-body"');
  });

  it('preserves auth headers alongside serializer-supplied content type', async () => {
    const sender = new DefaultPushNotificationSender(store);
    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save(
      'task-auth',
      ctxV1,
      makeConfig(`${baseUrl}/notify`, {
        authentication: { scheme: 'Bearer', credentials: 'token-xyz' },
      })
    );

    await sender.send(makeStatusUpdate('task-auth'), ctxV1);

    expect(received).toHaveLength(1);
    expect(received[0].headers['authorization']).toBe('Bearer token-xyz');
    expect(received[0].headers['content-type']).toBe(A2A_CONTENT_TYPE);
  });

  it('delivers message payloads with task association per §4.3.3', async () => {
    // Per spec §4.3.3 push notifications accept all four StreamResponse
    // payload variants. The built-in v1.0 serializer encodes the message as
    // part of the canonical StreamResponse JSON wrapper.
    const sender = new DefaultPushNotificationSender(store);
    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });
    await store.save('task-msg', ctxV1, makeConfig(`${baseUrl}/notify`));

    await sender.send(makeMessage('task-msg'), ctxV1);

    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toBe(A2A_CONTENT_TYPE);
    expect(received[0].body).toEqual(StreamResponse.toJSON(makeMessage('task-msg')));
  });

  it('silently skips dispatch for stand-alone messages (no task association)', async () => {
    // Message-only stream pattern (§3.1.2): no taskId means no config can
    // ever match. Sender returns silently without hitting the store.
    const sender = new DefaultPushNotificationSender(store);
    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });

    await sender.send(makeMessage(''), ctxV1);

    expect(received).toHaveLength(0);
  });

  it('fallback path: uses context.requestedVersion when the store omits loadWithMetadata', async () => {
    // Custom store path: when loadWithMetadata is absent, the sender tags
    // each entry with the wire version of the triggering request. A v0.3
    // trigger picks up the registered V03 serializer.
    const customConfig = makeConfig(`${baseUrl}/notify`, { id: 'cfg-leg' });
    const customStore: PushNotificationStore = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => [customConfig]),
      delete: vi.fn(async () => {}),
    };
    const v03Serializer: PushNotificationSerializer = {
      serialize(): SerializedPushNotification {
        return { body: '{"v":"0.3-fallback"}', contentType: 'application/json' };
      },
    };
    const sender = new DefaultPushNotificationSender(customStore, {
      serializers: { [ProtocolVersion.V0_3]: v03Serializer },
    });
    const ctxV03 = new ServerCallContext({ requestedVersion: A2A_LEGACY_PROTOCOL_VERSION });

    await sender.send(makeStatusUpdate('task-leg'), ctxV03);

    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toBe('application/json');
    expect(received[0].rawBody).toBe('{"v":"0.3-fallback"}');
    expect(customStore.load).toHaveBeenCalledTimes(1);
  });

  it("fallback path: defaults to '0.3' per §3.6.2 when context has no version", async () => {
    // Defensive: a context constructed without requestedVersion (e.g. by a
    // caller bypassing the transport layer) must still fall back to '0.3'
    // per spec §3.6.2's absent-header rule.
    const customConfig = makeConfig(`${baseUrl}/notify`, { id: 'cfg-defensive' });
    const customStore: PushNotificationStore = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => [customConfig]),
      delete: vi.fn(async () => {}),
    };
    const v03Serializer: PushNotificationSerializer = {
      serialize(): SerializedPushNotification {
        return { body: '{"v":"defensive-0.3"}', contentType: 'application/json' };
      },
    };
    const sender = new DefaultPushNotificationSender(customStore, {
      serializers: { [ProtocolVersion.V0_3]: v03Serializer },
    });
    const ctxEmpty = new ServerCallContext({ requestedVersion: '' });

    await sender.send(makeStatusUpdate('task-defensive'), ctxEmpty);

    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toBe('application/json');
    expect(received[0].rawBody).toBe('{"v":"defensive-0.3"}');
  });

  it('bare-minimum v1.0 setup: custom store without loadWithMetadata sends v1.0 bodies and emits no warning', async () => {
    // Mirrors the README claim: a pure-v1.0 user with NO compat opt-in must
    // not see any compat-layer noise (no warnings, no body shape mismatch)
    // even when using a custom PushNotificationStore that does not
    // implement loadWithMetadata.
    const customConfig = makeConfig(`${baseUrl}/notify`, { id: 'cfg-bare-v1' });
    const customStore: PushNotificationStore = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => [customConfig]),
      delete: vi.fn(async () => {}),
      // Intentionally omits loadWithMetadata.
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Default sender — only the built-in V1 serializer. No compat opt-in.
    const sender = new DefaultPushNotificationSender(customStore);
    const ctxV1 = new ServerCallContext({ requestedVersion: A2A_PROTOCOL_VERSION });

    await sender.send(makeStatusUpdate('task-bare-v1'), ctxV1);

    // Webhook receives the canonical v1.0 body and content-type.
    expect(received).toHaveLength(1);
    expect(received[0].headers['content-type']).toBe(A2A_CONTENT_TYPE);
    expect(received[0].body).toEqual(StreamResponse.toJSON(makeStatusUpdate('task-bare-v1')));
    // No warnings of any kind — pure v1.0 users have no reason to see
    // compat-layer logs.
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('V1PushNotificationSerializer', () => {
  it('emits StreamResponse.toJSON body and the v1.0 content type', () => {
    const serializer = new V1PushNotificationSerializer();
    const event = makeStatusUpdate('task-x');
    const result = serializer.serialize(event);
    expect(result.contentType).toBe(A2A_CONTENT_TYPE);
    expect(JSON.parse(result.body)).toEqual(StreamResponse.toJSON(event));
  });
});

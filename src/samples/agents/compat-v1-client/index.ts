/**
 * Sample: v1.0-native A2A client driver showcasing the v0.3 compat layer.
 *
 * Pairs with `../compat-v1-server/` (the v1.0-native server with
 * `legacyCompat: { enabled: true }` opted into every handler). The
 * driver also spins up a hand-rolled MOCK v0.3 server in-process (see
 * `_mock-v0_3-server.ts`) so the "v1.0+compat client → real v0.3 peer"
 * scenario can be demonstrated end-to-end without external setup.
 *
 * Everything in THIS file uses only the SDK's public client API
 * (`ClientFactory`, `DefaultAgentCardResolver`, the per-transport
 * factories, all with `legacyCompat: { enabled: true }`). The
 * compat-aware client never needs to know which of its peers is v1.0
 * vs. v0.3 — that's the whole point.
 *
 * Flow:
 *   1. Compat-aware client → v1.0+compat server (HTTP/JSON-RPC):
 *      hybrid card resolves to v1.0, no downgrade dance.
 *   2. Same client wiring → mock v0.3 server: card-shape detection
 *      flips the JsonRpcTransportFactory over to the legacy transport
 *      automatically.
 *   3. Compat-aware client → v1.0+compat server over gRPC.
 *   4. v1.0 push notification: client → v1.0+compat server with a
 *      webhook config. The in-process receiver sees
 *      `application/a2a+json` `StreamResponse` envelopes.
 *   5. v0.3 push notification: client → mock v0.3 server with a
 *      webhook config. The receiver sees `application/json` bare-event
 *      bodies. Same compat-aware client API; the wire-shape
 *      difference comes from the peer.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import {
  Message,
  Part,
  SendMessageRequest,
  StreamResponse,
  TaskPushNotificationConfig,
  taskStateToJSON,
} from '../../../index.js';
import { Role } from '../../../types/pb/a2a.js';
import {
  Client,
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from '../../../client/index.js';
import { GrpcTransportFactory } from '../../../client/transports/grpc/grpc_transport.js';
import { startMockV03Server } from './_mock-v0_3-server.js';

// --- Server endpoints ---

const COMPAT_HTTP_PORT = Number(process.env.COMPAT_HTTP_PORT || 41251);
const COMPAT_GRPC_PORT = Number(process.env.COMPAT_GRPC_PORT || 41252);
const COMPAT_BASE_URL = `http://localhost:${COMPAT_HTTP_PORT}`;
const COMPAT_GRPC_TARGET = `localhost:${COMPAT_GRPC_PORT}`;

const MOCK_V03_PORT = Number(process.env.MOCK_V03_PORT || 41253);
const MOCK_V03_BASE_URL = `http://localhost:${MOCK_V03_PORT}`;

const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || 42424);
const WEBHOOK_URL = `http://localhost:${WEBHOOK_PORT}/webhook/task-updates`;
const WEBHOOK_TOKEN = 'compat-demo-token';

// Content types we want to print and compare side-by-side. Defined
// inline (rather than imported from `@a2a-js/sdk/compat/v0_3/constants`)
// so this driver's only SDK dependency is the public client API.
const V1_CONTENT_TYPE = 'application/a2a+json';
const V03_CONTENT_TYPE = 'application/json';

// =============================================================================
// In-process webhook receiver
// =============================================================================

interface ReceivedWebhook {
  contentType: string;
  body: unknown;
}

const capturedWebhooks = new Map<string, ReceivedWebhook[]>();

function eventTaskId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  // v1.0 StreamResponse envelope.
  for (const key of ['task', 'statusUpdate', 'artifactUpdate', 'message']) {
    const inner = b[key];
    if (inner && typeof inner === 'object') {
      const ib = inner as Record<string, unknown>;
      if (typeof ib['id'] === 'string') return ib['id'] as string;
      if (typeof ib['taskId'] === 'string') return ib['taskId'] as string;
    }
  }
  // v0.3 bare event.
  if (typeof b['id'] === 'string' && b['kind'] === 'task') return b['id'] as string;
  if (typeof b['taskId'] === 'string') return b['taskId'] as string;
  return undefined;
}

async function startWebhookReceiver(): Promise<void> {
  const app = express();
  app.use(
    express.json({
      limit: '1mb',
      type: [V03_CONTENT_TYPE, V1_CONTENT_TYPE],
    })
  );
  app.post('/webhook/task-updates', (req, res) => {
    const token = req.header('X-A2A-Notification-Token');
    if (token !== WEBHOOK_TOKEN) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const contentType = req.header('Content-Type') ?? '(missing)';
    const body = req.body ?? {};
    const taskId = eventTaskId(body);
    if (taskId) {
      const bucket = capturedWebhooks.get(taskId) ?? [];
      bucket.push({ contentType, body });
      capturedWebhooks.set(taskId, bucket);
    }
    res.status(200).json({ received: true });
  });
  await new Promise<void>((resolve, reject) => {
    // Express's `app.listen` does NOT pass an error to its callback —
    // the callback is registered for the `'listening'` event and takes
    // no arguments. Startup errors (e.g. `EADDRINUSE`) are emitted on
    // the returned server instance via the `'error'` event.
    const server = app.listen(WEBHOOK_PORT, () => {
      console.log(`[Webhook] In-process receiver on ${WEBHOOK_URL}`);
      resolve();
    });
    server.on('error', reject);
  });
}

function summarizeWebhookBody(body: unknown): string {
  if (!body || typeof body !== 'object') return String(body);
  const b = body as Record<string, unknown>;
  for (const key of ['task', 'statusUpdate', 'artifactUpdate', 'message']) {
    if (b[key]) {
      return `v1.0 StreamResponse{${key}}`;
    }
  }
  if (typeof b['kind'] === 'string') {
    return `v0.3 bare event{kind: '${b['kind']}'}`;
  }
  return JSON.stringify(body).slice(0, 80);
}

function printReceivedWebhooks(taskId: string, expectedContentType: string): void {
  const events = capturedWebhooks.get(taskId) ?? [];
  console.log(`[Webhook] Captured ${events.length} webhook(s) for task ${taskId}:`);
  for (const event of events) {
    const match = event.contentType === expectedContentType ? '✓' : '?';
    console.log(`[Webhook]   Content-Type: ${event.contentType} ${match}`);
    console.log(`[Webhook]   Body summary: ${summarizeWebhookBody(event.body)}`);
  }
}

// =============================================================================
// Compat-aware client factory
// =============================================================================

/**
 * Builds a "compat-aware" v1.0 client factory: every transport factory
 * AND the card resolver have `legacyCompat: { enabled: true }` set, so
 * the same factory can talk to both v1.0 and v0.3 servers.
 *
 * `ClientFactory` itself doesn't take a `legacyCompat` option — the
 * opt-in is per transport factory and per resolver. This mirrors the
 * server side, where each Express handler takes its own `legacyCompat`
 * opt-in.
 */
function makeCompatAwareFactory(): ClientFactory {
  return new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      cardResolver: new DefaultAgentCardResolver({ legacyCompat: { enabled: true } }),
      transports: [
        new JsonRpcTransportFactory({ legacyCompat: { enabled: true } }),
        new RestTransportFactory({ legacyCompat: { enabled: true } }),
        new GrpcTransportFactory({ legacyCompat: { enabled: true } }),
      ],
    })
  );
}

function describeClient(client: Client, label: string): void {
  const transportClass = Object.getPrototypeOf(client.transport).constructor.name;
  console.log(`[Client] ${label}: transport=${transportClass} version=${client.protocolVersion}`);
}

// =============================================================================
// Message helpers
// =============================================================================

function buildSendMessageRequest(
  text: string,
  push?: { url: string; token: string }
): SendMessageRequest {
  const taskPushNotificationConfig: TaskPushNotificationConfig | undefined = push
    ? {
        id: '',
        taskId: '',
        tenant: '',
        url: push.url,
        token: push.token,
        authentication: undefined,
      }
    : undefined;
  return {
    tenant: '',
    metadata: {},
    message: {
      messageId: uuidv4(),
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: 'text', value: text },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        },
      ],
      taskId: '',
      contextId: '',
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    },
    configuration: push
      ? {
          acceptedOutputModes: ['text/plain'],
          taskPushNotificationConfig,
          returnImmediately: false,
        }
      : undefined,
  };
}

async function runRoundTrip(client: Client, text: string): Promise<void> {
  for await (const event of client.sendMessageStream(buildSendMessageRequest(text))) {
    printStreamEvent(event);
  }
}

function printStreamEvent(event: StreamResponse): void {
  const payload = event.payload;
  if (!payload) return;
  switch (payload.$case) {
    case 'task': {
      // `status` is optional on the proto `Task`; guard against a peer
      // that emits a task without one.
      const state = payload.value.status ? taskStateToJSON(payload.value.status.state) : 'UNKNOWN';
      console.log(`[Client] task           id=${payload.value.id} state=${state}`);
      break;
    }
    case 'statusUpdate': {
      const state = payload.value.status ? taskStateToJSON(payload.value.status.state) : 'UNKNOWN';
      console.log(`[Client] statusUpdate   task=${payload.value.taskId} state=${state}`);
      if (payload.value.status?.message) {
        printMessage(payload.value.status.message);
      }
      break;
    }
    case 'artifactUpdate':
      console.log(
        `[Client] artifactUpdate task=${payload.value.taskId} artifact=${payload.value.artifact?.name ?? '(unnamed)'}`
      );
      for (const part of payload.value.artifact?.parts ?? []) {
        printPart(part);
      }
      break;
    case 'message':
      console.log(`[Client] message        messageId=${payload.value.messageId}`);
      printMessage(payload.value);
      break;
  }
}

function printMessage(message: Message): void {
  for (const part of message.parts) {
    printPart(part);
  }
}

function printPart(part: Part): void {
  const c = part.content;
  if (!c) return;
  switch (c.$case) {
    case 'text':
      console.log(`[Client]   text: ${c.value}`);
      break;
    case 'data':
      console.log(`[Client]   data: ${JSON.stringify(c.value)}`);
      break;
    case 'url':
      console.log(`[Client]   url:  ${c.value}`);
      break;
    case 'raw':
      console.log(`[Client]   raw:  (${c.value.length} bytes)`);
      break;
  }
}

async function sendWithPushAndWait(client: Client): Promise<string> {
  const params = buildSendMessageRequest('long-running task with push notification', {
    url: WEBHOOK_URL,
    token: WEBHOOK_TOKEN,
  });
  const result = await client.sendMessage(params);
  if (!('id' in result)) {
    throw new Error('Expected a Task in the sendMessage response');
  }
  const taskId = result.id;
  const state = result.status ? taskStateToJSON(result.status.state) : 'UNKNOWN';
  console.log(`[Client] sendMessage returned task id=${taskId} state=${state}`);
  // `sendMessage` returns once the task reaches a terminal state, but
  // the server-side push dispatch is fire-and-forget. Small grace
  // window so all webhooks land before we print.
  await sleep(500);
  return taskId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log(
    `[Client] v1.0+compat server: ${COMPAT_BASE_URL} (HTTP) / ${COMPAT_GRPC_TARGET} (gRPC)`
  );
  console.log(`[Client] Mock v0.3 server:   ${MOCK_V03_BASE_URL} (in-process)`);
  console.log(`[Client] Webhook receiver:   ${WEBHOOK_URL} (in-process)`);
  console.log(`[Client] Make sure the compat server is running: npm run agents:compat-v1-server`);

  await Promise.all([startMockV03Server({ port: MOCK_V03_PORT }), startWebhookReceiver()]);

  // ---------------------------------------------------------------------------
  // 1. Compat-aware v1.0 client → v1.0+compat server (JSON-RPC).
  //    The server's hybrid card carries v1.0 `supportedInterfaces[]`,
  //    so the resolver picks v1.0 even though `legacyCompat` is on
  //    (no downgrade dance).
  // ---------------------------------------------------------------------------
  console.log(`\n[Client] === v1.0+compat server, JSON-RPC ===`);
  const compatHttpClient = await makeCompatAwareFactory().createFromUrl(COMPAT_BASE_URL);
  describeClient(compatHttpClient, 'compat-aware → v1.0 server');
  await runRoundTrip(compatHttpClient, 'hello v1.0 server');

  // ---------------------------------------------------------------------------
  // 2. Same compat-aware factory → mock v0.3 server.
  //    The server's card has no `supportedInterfaces[]`; the resolver
  //    detects v0.3 by response shape, and the
  //    `JsonRpcTransportFactory` dispatches to its v0.3 transport
  //    automatically.
  // ---------------------------------------------------------------------------
  console.log(`\n[Client] === Mock v0.3 server, JSON-RPC ===`);
  const mockV03Client = await makeCompatAwareFactory().createFromUrl(MOCK_V03_BASE_URL);
  describeClient(mockV03Client, 'compat-aware → mock v0.3 server');
  await runRoundTrip(mockV03Client, 'hello v0.3 server');

  // ---------------------------------------------------------------------------
  // 3. Compat-aware factory → v1.0+compat server over gRPC.
  // ---------------------------------------------------------------------------
  console.log(`\n[Client] === v1.0+compat server, gRPC ===`);
  const grpcFactory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      cardResolver: new DefaultAgentCardResolver({ legacyCompat: { enabled: true } }),
      transports: [new GrpcTransportFactory({ legacyCompat: { enabled: true } })],
      preferredTransports: ['GRPC'],
    })
  );
  const grpcClient = await grpcFactory.createFromUrl(COMPAT_BASE_URL);
  describeClient(grpcClient, 'compat-aware → v1.0 server (gRPC)');
  await runRoundTrip(grpcClient, 'hello v1.0 server over gRPC');

  // ---------------------------------------------------------------------------
  // 4. v1.0 push notification: client → v1.0+compat server.
  //    Webhook body: v1.0 `StreamResponse` envelopes, `application/a2a+json`.
  // ---------------------------------------------------------------------------
  console.log(`\n[Client] === Push notification → v1.0+compat server ===`);
  const v1PushClient = await makeCompatAwareFactory().createFromUrl(COMPAT_BASE_URL);
  describeClient(v1PushClient, 'push → v1.0 server');
  const v1TaskId = await sendWithPushAndWait(v1PushClient);
  printReceivedWebhooks(v1TaskId, V1_CONTENT_TYPE);

  // ---------------------------------------------------------------------------
  // 5. v0.3 push notification: client → mock v0.3 server.
  //    Webhook body: bare v0.3 events with inner `kind` discriminator,
  //    `application/json`. Same compat-aware client code as step 4;
  //    the wire-shape difference comes entirely from the peer.
  // ---------------------------------------------------------------------------
  console.log(`\n[Client] === Push notification → mock v0.3 server ===`);
  const v03PushClient = await makeCompatAwareFactory().createFromUrl(MOCK_V03_BASE_URL);
  describeClient(v03PushClient, 'push → mock v0.3 server');
  const v03TaskId = await sendWithPushAndWait(v03PushClient);
  printReceivedWebhooks(v03TaskId, V03_CONTENT_TYPE);

  console.log(`\n[Client] Done.`);

  // The in-process fixtures, webhook receiver, and gRPC transport own
  // native resources; an explicit exit avoids hanging on Node's event
  // loop.
  process.exit(0);
}

main().catch((err) => {
  console.error('[Client] Error:', err);
  process.exit(1);
});

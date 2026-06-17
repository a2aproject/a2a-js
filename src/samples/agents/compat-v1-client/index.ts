/**
 * Sample: v1.0-native A2A client driver showcasing the v0.3 compat layer.
 *
 * Pairs with `../compat-v1-server/` (the dual-version A2A server). See
 * `src/compat/v0_3/README.md` for the underlying architecture.
 *
 * Flow:
 *   1. Spin up an in-process pure-v0.3 server so the second half of the
 *      driver has something legacy to talk to.
 *   2. Spin up an in-process webhook receiver that accepts BOTH the v1.0
 *      `application/a2a+json` `StreamResponse` envelope AND the v0.3
 *      `application/json` bare-event body, then prints what it received
 *      so the wire-shape difference is visible at runtime.
 *   3. Open a "compat-aware" v1.0 client (with `legacyCompat: { enabled:
 *      true }` opted in on every transport factory and on the card
 *      resolver) against the dual-version compat server. Confirm that
 *      it Just Works without downgrading the wire to v0.3, then run a
 *      streaming send-message round-trip.
 *   4. Reuse the SAME factory wiring against the pure-v0.3 server.
 *      Confirm the resolver detected the v0.3-shaped card by response
 *      shape, the factory dispatched to `LegacyJsonRpcTransport`, and
 *      run another streaming send-message round-trip to prove the
 *      v0.3 wire path is exercised end-to-end.
 *   5. Switch to a gRPC-only factory against the compat server's
 *      gRPC endpoint, to demonstrate the same compat-dispatch logic on
 *      a different transport.
 *   6. Register a v1.0 webhook against the compat server (via
 *      `JsonRpcTransport`). The server's
 *      `createLegacyAwarePushNotificationSender` picks the
 *      `V1PushNotificationSerializer` because the registration context
 *      carries `requestedVersion: '1.0'`. The webhook receiver shows
 *      `application/a2a+json` `StreamResponse` envelopes.
 *   7. Register a v0.3 webhook against the SAME compat server (via
 *      `LegacyJsonRpcTransport`, by handing the factory a synthetic
 *      v0.3-only card pointing at the compat server's URL). The
 *      registration context carries `requestedVersion: '0.3'`, so the
 *      same sender picks the `V03PushNotificationSerializer` for THIS
 *      webhook. The webhook receiver shows `application/json` bare
 *      v0.3 events on the same server.
 *
 * Each step prints the resolved transport class + protocol version so
 * the dispatch decisions are visible in the output.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import {
  AGENT_CARD_PATH,
  AgentCard,
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
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  ServerCallContext,
  UnauthenticatedUser,
} from '../../../server/index.js';
import { toCompatAgentCard } from '../../../compat/v0_3/translate/agent_card.js';
import { LegacyJsonRpcTransportHandler } from '../../../compat/v0_3/server/transports/jsonrpc/jsonrpc_transport_handler.js';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  LEGACY_JSON_CONTENT_TYPE,
} from '../../../compat/v0_3/constants.js';
import { A2A_CONTENT_TYPE } from '../../../constants.js';
import { SSE_HEADERS, formatSSEEvent, formatSSEErrorEvent } from '../../../sse_utils.js';
import { SampleAgentExecutor } from '../sample-agent/agent_executor.js';

// --- Server endpoints ---
//
// Default to the compat server defined in `../compat-v1-server/index.ts`.
// Override via env if you've moved it.
const COMPAT_HTTP_PORT = Number(process.env.COMPAT_HTTP_PORT || 41251);
const COMPAT_GRPC_PORT = Number(process.env.COMPAT_GRPC_PORT || 41252);
const COMPAT_BASE_URL = `http://localhost:${COMPAT_HTTP_PORT}`;
const COMPAT_GRPC_TARGET = `localhost:${COMPAT_GRPC_PORT}`;
const COMPAT_JSON_RPC_URL = `${COMPAT_BASE_URL}/a2a/jsonrpc`;

// In-process pure-v0.3 server so the showcase is self-contained.
const V03_ONLY_PORT = Number(process.env.V03_ONLY_PORT || 41253);
const V03_ONLY_BASE_URL = `http://localhost:${V03_ONLY_PORT}`;

// In-process webhook receiver for the push-notification half of the demo.
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || 42424);
const WEBHOOK_URL = `http://localhost:${WEBHOOK_PORT}/webhook/task-updates`;
const WEBHOOK_TOKEN = 'compat-demo-token';

// =============================================================================
// Pure v0.3 in-process server (used by step 4).
// =============================================================================

/**
 * Spawns a deliberately-pure v0.3 server: only the legacy JSON-RPC
 * handler and a single well-known card endpoint that serves a
 * v0.3-shaped body unconditionally. This is the "legacy server in the
 * wild" fixture that a v1.0 client with compat opted in is supposed to
 * interoperate with transparently.
 */
async function startPureV03Server(): Promise<void> {
  const card: AgentCard = {
    name: 'Pure v0.3 Server',
    description: 'A deliberately pure v0.3 server used by the compat client showcase.',
    supportedInterfaces: [
      {
        url: `${V03_ONLY_BASE_URL}/a2a/jsonrpc`,
        protocolBinding: 'JSONRPC',
        tenant: '',
        // The source card declares v0.3 — that's what makes this a "pure
        // v0.3 server". `toCompatAgentCard` below relies on a legacy
        // interface being present to pick the primary URL for the v0.3
        // card it emits on the wire.
        protocolVersion: A2A_LEGACY_PROTOCOL_VERSION,
      },
    ],
    provider: { organization: 'A2A Samples', url: 'https://example.com/a2a-samples' },
    // `version` here is the AGENT implementation version (free-form),
    // not the A2A protocol version — protocol version lives on each
    // `supportedInterfaces[]` entry above. Pinning it to `0.3.0` keeps
    // the "pure v0.3" story consistent for human readers, even though
    // the SDK never inspects this value.
    version: '0.3.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: [
      {
        id: 'sample_agent',
        name: 'Sample Agent',
        description: 'Reuses the SampleAgentExecutor over the v0.3 wire.',
        tags: ['sample', 'v0.3'],
        examples: ['hi'],
        inputModes: ['text'],
        outputModes: ['text', 'task-status'],
        securityRequirements: [],
      },
    ],
    documentationUrl: '',
    signatures: [],
  };

  const requestHandler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    new SampleAgentExecutor()
  );

  const app = express();

  // Pre-translated v0.3 card, served unconditionally. We bypass the
  // SDK's `legacyAgentCardRouter` here because that router only emits a
  // v0.3 body for legacy-range `A2A-Version` headers, and the SDK's
  // `DefaultAgentCardResolver` always sends `A2A-Version: 1.0` on the
  // discovery request to avoid a downgrade dance — detection is
  // response-shape based by design.
  const legacyCard = toCompatAgentCard(await requestHandler.getAgentCard());
  app.get(`/${AGENT_CARD_PATH}`, (_req, res) => {
    res.setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE);
    res.status(200).send(JSON.stringify(legacyCard));
  });

  const legacyJsonRpc = new LegacyJsonRpcTransportHandler(requestHandler);
  app.post(
    '/a2a/jsonrpc',
    express.json({ type: LEGACY_JSON_CONTENT_TYPE, strict: false }),
    async (req, res) => {
      try {
        const context = new ServerCallContext({
          requestedExtensions: [],
          user: new UnauthenticatedUser(),
          requestedVersion: '0.3',
        });
        const result = await legacyJsonRpc.handle(req.body, context);
        if (
          result &&
          typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
        ) {
          // Streaming method: pump v0.3 envelopes back as SSE — one
          // JSON-RPC envelope per `data:` line, mirroring what
          // `LegacyJsonRpcTransport._sendStreamingRequest` parses on
          // the client side.
          for (const [key, value] of Object.entries(SSE_HEADERS)) {
            res.setHeader(key, value);
          }
          res.flushHeaders();
          try {
            for await (const event of result as AsyncIterable<unknown>) {
              res.write(formatSSEEvent(event));
            }
          } catch (streamErr) {
            res.write(formatSSEErrorEvent({ code: -32603, message: (streamErr as Error).message }));
          } finally {
            res.end();
          }
          return;
        }
        res.setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE);
        res.status(200).json(result);
      } catch (err: unknown) {
        res
          .status(500)
          .json({ jsonrpc: '2.0', error: { code: -32603, message: (err as Error).message } });
      }
    }
  );

  await new Promise<void>((resolve, reject) => {
    app.listen(V03_ONLY_PORT, (err) => {
      if (err) {
        reject(err);
        return;
      }
      console.log(`[V03Server] In-process pure-v0.3 server on ${V03_ONLY_BASE_URL}`);
      resolve();
    });
  });
}

// =============================================================================
// Webhook receiver (used by steps 6 and 7).
// =============================================================================

/**
 * A single received webhook POST, captured for printing.
 */
interface ReceivedWebhook {
  contentType: string;
  body: unknown;
}

/**
 * All webhook deliveries captured so far, bucketed by taskId. The
 * webhook handler appends to this map for every accepted POST,
 * regardless of whether anyone is "watching" the task yet — this avoids
 * the race where the v1.0 `sendMessage` (which blocks until the task
 * reaches a terminal state) returns AFTER the server has already
 * dispatched several webhooks. Callers query the map by taskId AFTER
 * the round-trip completes.
 */
const capturedWebhooks = new Map<string, ReceivedWebhook[]>();

function eventTaskId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  // v1.0 StreamResponse envelope: `{ task: {...} }` / `{ statusUpdate: {...} }` etc.
  for (const key of ['task', 'statusUpdate', 'artifactUpdate', 'message']) {
    const inner = b[key];
    if (inner && typeof inner === 'object') {
      const ib = inner as Record<string, unknown>;
      if (typeof ib['id'] === 'string') return ib['id'] as string;
      if (typeof ib['taskId'] === 'string') return ib['taskId'] as string;
    }
  }
  // v0.3 bare event: `kind` lives on the body itself.
  if (typeof b['id'] === 'string' && b['kind'] === 'task') return b['id'] as string;
  if (typeof b['taskId'] === 'string') return b['taskId'] as string;
  return undefined;
}

async function startWebhookReceiver(): Promise<void> {
  const app = express();

  // Accept BOTH content types: v0.3 sends `application/json`, v1.0 sends
  // `application/a2a+json`. Without explicitly allow-listing both,
  // `express.json()` parses only `application/json`.
  app.use(
    express.json({
      limit: '1mb',
      type: [LEGACY_JSON_CONTENT_TYPE, A2A_CONTENT_TYPE],
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
    app.listen(WEBHOOK_PORT, (err) => {
      if (err) {
        reject(err);
        return;
      }
      console.log(`[Webhook] In-process receiver on ${WEBHOOK_URL}`);
      resolve();
    });
  });
}

function printReceivedWebhooks(taskId: string, expectedContentType: string): void {
  const events = capturedWebhooks.get(taskId) ?? [];
  console.log(`[Webhook] Captured ${events.length} webhook(s) for task ${taskId}:`);
  for (const event of events) {
    const match = event.contentType === expectedContentType ? '✓' : '?';
    console.log(`[Webhook]   Content-Type: ${event.contentType} ${match}`);
    // Print a one-line summary that's distinctive per wire shape.
    const summary = summarizeWebhookBody(event.body);
    console.log(`[Webhook]   Body summary: ${summary}`);
  }
}

function summarizeWebhookBody(body: unknown): string {
  if (!body || typeof body !== 'object') return String(body);
  const b = body as Record<string, unknown>;
  // v1.0 outer-discriminator
  for (const key of ['task', 'statusUpdate', 'artifactUpdate', 'message']) {
    if (b[key]) {
      return `v1.0 StreamResponse{${key}}`;
    }
  }
  // v0.3 inner-discriminator
  if (typeof b['kind'] === 'string') {
    return `v0.3 bare event{kind: '${b['kind']}'}`;
  }
  return JSON.stringify(body).slice(0, 80);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Builds a "compat-aware" v1.0 client factory: every transport factory
 * AND the card resolver have `legacyCompat: { enabled: true }` set, so
 * the same factory can talk to both v1.0 servers and v0.3 servers.
 *
 * Note that `ClientFactory` itself doesn't take a `legacyCompat`
 * option — the opt-in is per transport factory and per resolver. This
 * mirrors the server side, where each handler (jsonRpcHandler,
 * restHandler, agentCardHandler) takes its own `legacyCompat` opt-in.
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
    case 'task':
      console.log(
        `[Client] task           id=${payload.value.id} state=${taskStateToJSON(payload.value.status!.state)}`
      );
      break;
    case 'statusUpdate':
      console.log(
        `[Client] statusUpdate   task=${payload.value.taskId} state=${taskStateToJSON(
          payload.value.status!.state
        )}`
      );
      if (payload.value.status?.message) {
        printMessage(payload.value.status.message);
      }
      break;
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

// =============================================================================
// Push-notification helpers
// =============================================================================

/**
 * Sends a non-streaming message with a webhook config and waits until
 * the in-process receiver observes a terminal status event for the new
 * task. Returns the taskId so the caller can print the captured events.
 */
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
  console.log(
    `[Client] sendMessage returned task id=${taskId} state=${taskStateToJSON(result.status!.state)}`
  );
  // `sendMessage` (default `returnImmediately: false`) returns once the
  // task reaches a terminal state, but the server-side push dispatch
  // happens in a fire-and-forget code path. Give the receiver a short
  // grace window to absorb any in-flight webhooks before we print.
  await sleep(500);
  return taskId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds a v0.3-only synthetic AgentCard pointing at the compat
 * server's JSON-RPC URL. Handed to a compat-aware `ClientFactory`, the
 * factory's `JsonRpcTransportFactory` will see `protocolVersion: '0.3'`
 * on the matched interface and dispatch to `LegacyJsonRpcTransport`.
 * This is how we coerce a v0.3 wire path against a server whose primary
 * card is v1.0.
 */
function makeV03OnlyCardForCompatServer(): AgentCard {
  return {
    name: 'Compat Server (v0.3 facade)',
    description:
      'Synthetic card used by the client driver to force the v0.3 wire path ' +
      'against the compat server (whose well-known card is v1.0-primary).',
    supportedInterfaces: [
      {
        url: COMPAT_JSON_RPC_URL,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: A2A_LEGACY_PROTOCOL_VERSION,
      },
    ],
    provider: { organization: 'A2A Samples', url: 'https://example.com/a2a-samples' },
    version: '0.3.0',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: [],
    documentationUrl: '',
    signatures: [],
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log(
    `[Client] Compat server:    ${COMPAT_BASE_URL} (HTTP) / ${COMPAT_GRPC_TARGET} (gRPC)`
  );
  console.log(`[Client] Pure-v0.3 server: ${V03_ONLY_BASE_URL} (in-process)`);
  console.log(`[Client] Webhook receiver: ${WEBHOOK_URL} (in-process)`);
  console.log(`[Client] Make sure the compat server is running: npm run agents:compat-v1-server`);

  // Spin up the in-process pure-v0.3 server and webhook receiver.
  await Promise.all([startPureV03Server(), startWebhookReceiver()]);

  // ---------------------------------------------------------------------------
  // Compat-aware v1.0 client against the dual-version compat server.
  // The hybrid card carries an embedded v1.0 `supportedInterfaces[]`, so the
  // resolver picks the v1.0 representation: no downgrade dance even though
  // `legacyCompat` is on.
  // ---------------------------------------------------------------------------
  console.log(`\n[Client] === Connecting to compat server over HTTP (JSON-RPC) ===`);
  const compatHttpClient = await makeCompatAwareFactory().createFromUrl(COMPAT_BASE_URL);
  describeClient(compatHttpClient, 'compat-aware → compat server');
  await runRoundTrip(compatHttpClient, 'hello from compat-aware client to compat server');

  // ---------------------------------------------------------------------------
  // Same factory wiring against the pure-v0.3 server.
  // The legacy card has no embedded `supportedInterfaces`; the resolver
  // translates it, every synthesized interface carries `protocolVersion: '0.3'`,
  // and the `JsonRpcTransportFactory` dispatches to `LegacyJsonRpcTransport`.
  // ---------------------------------------------------------------------------
  console.log(`\n[Client] === Connecting to pure-v0.3 server over HTTP (JSON-RPC) ===`);
  const v03Client = await makeCompatAwareFactory().createFromUrl(V03_ONLY_BASE_URL);
  describeClient(v03Client, 'compat-aware → pure-v0.3 server');
  await runRoundTrip(v03Client, 'hello from compat-aware client to pure-v0.3 server');

  // ---------------------------------------------------------------------------
  // gRPC-only factory against the compat server, to show the same
  // compat-dispatch logic on a different transport.
  // ---------------------------------------------------------------------------
  console.log(`\n[Client] === Connecting to compat server over gRPC ===`);
  const grpcFactory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      cardResolver: new DefaultAgentCardResolver({ legacyCompat: { enabled: true } }),
      transports: [new GrpcTransportFactory({ legacyCompat: { enabled: true } })],
      // Force gRPC even though the card lists JSONRPC first.
      preferredTransports: ['GRPC'],
    })
  );
  const grpcClient = await grpcFactory.createFromUrl(COMPAT_BASE_URL);
  describeClient(grpcClient, 'compat-aware → compat server (gRPC)');
  await runRoundTrip(grpcClient, 'hello from compat-aware client to compat server over gRPC');

  // ---------------------------------------------------------------------------
  // Push-notification round-trip: v1.0 client → compat server.
  // The compat server uses `createLegacyAwarePushNotificationSender`,
  // which picks the V1PushNotificationSerializer because the
  // registration context carries `requestedVersion: '1.0'`. The webhook
  // body is the v1.0 `StreamResponse` envelope with
  // `Content-Type: application/a2a+json`.
  // ---------------------------------------------------------------------------
  console.log(`\n[Client] === v1.0 push notification → compat server ===`);
  const v1PushClient = await makeCompatAwareFactory().createFromUrl(COMPAT_BASE_URL);
  describeClient(v1PushClient, 'v1.0 push → compat server');
  const v1TaskId = await sendWithPushAndWait(v1PushClient);
  printReceivedWebhooks(v1TaskId, A2A_CONTENT_TYPE);

  // ---------------------------------------------------------------------------
  // Push-notification round-trip: v0.3 client → SAME compat server.
  // We force the v0.3 wire path by handing the factory a synthetic
  // v0.3-only card; the compat-aware JsonRpcTransportFactory dispatches
  // to LegacyJsonRpcTransport. On the server side, the registration
  // context carries `requestedVersion: '0.3'`, so the same
  // (legacy-aware) sender picks V03PushNotificationSerializer for THIS
  // webhook. The webhook body is a bare v0.3 event with
  // `Content-Type: application/json`.
  // ---------------------------------------------------------------------------
  console.log(`\n[Client] === v0.3 push notification → compat server (same server!) ===`);
  const v03PushClient = await makeCompatAwareFactory().createFromAgentCard(
    makeV03OnlyCardForCompatServer()
  );
  describeClient(v03PushClient, 'v0.3 push → compat server');
  const v03TaskId = await sendWithPushAndWait(v03PushClient);
  printReceivedWebhooks(v03TaskId, LEGACY_JSON_CONTENT_TYPE);

  console.log(`\n[Client] Done.`);

  // The in-process fixtures, webhook receiver, and gRPC transport own
  // native resources; an explicit exit avoids leaving the process
  // hanging on Node's event loop.
  process.exit(0);
}

main().catch((err) => {
  console.error('[Client] Error:', err);
  process.exit(1);
});

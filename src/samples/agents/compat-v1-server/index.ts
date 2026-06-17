/**
 * Sample: v1.0-native A2A server with v0.3 compatibility enabled across
 * every transport, INCLUDING push notifications.
 *
 * This sample is the server side of a two-part showcase of the
 * `@a2a-js/sdk` v0.3 compat layer (see `src/compat/v0_3/README.md`). It
 * runs ONE shared `DefaultRequestHandler` behind:
 *
 *   - JSON-RPC over HTTP, with `legacyCompat: { enabled: true }` so the
 *     same endpoint accepts both v1.0 and v0.3 JSON-RPC bodies.
 *   - HTTP+JSON/REST, with `legacyCompat: { enabled: true }` so the same
 *     mount point serves both the v1.0 `POST /message:send` style routes
 *     AND the v0.3 reference `POST /v1/message:send` style routes.
 *   - gRPC, with the v1.0 `A2AService` AND the v0.3 `LegacyA2AService`
 *     registered side by side on a single gRPC `Server` (per the compat
 *     README §"Version negotiation under legacyCompat" — the v1.0 gRPC
 *     factory deliberately has no `legacyCompat` flag).
 *   - The well-known agent-card endpoint, with `legacyCompat: { enabled:
 *     true }` so the response shape adapts to the requester's
 *     `A2A-Version` header (defaulting to `'0.3'` when absent per
 *     §3.6.2).
 *   - Push notifications, wired through
 *     `createLegacyAwarePushNotificationSender`, which pre-registers a
 *     `V03PushNotificationSerializer` alongside the built-in
 *     `V1PushNotificationSerializer`. Webhooks registered over a v0.3
 *     transport receive v0.3-shaped bodies (`application/json`, bare
 *     event); webhooks registered over a v1.0 transport receive
 *     `application/a2a+json` `StreamResponse` envelopes — on the SAME
 *     task, on the same server.
 *
 * The agent card declared below intentionally contains ONLY v1.0
 * `supportedInterfaces` entries. The compat layer synthesizes the v0.3
 * surface automatically — no operator duplication required — which is
 * the whole point of opting into `legacyCompat`.
 */

import express from 'express';
import { Server, ServerCredentials } from '@grpc/grpc-js';

import { A2A_PROTOCOL_VERSION, AGENT_CARD_PATH, AgentCard } from '../../../index.js';
import {
  AgentExecutor,
  DefaultRequestHandler,
  InMemoryPushNotificationStore,
  InMemoryTaskStore,
  TaskStore,
} from '../../../server/index.js';
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from '../../../server/express/index.js';
import {
  A2AService,
  LegacyA2AService,
  grpcService,
  legacyGrpcService,
} from '../../../server/grpc/index.js';
import { createLegacyAwarePushNotificationSender } from '../../../compat/v0_3/server/index.js';
import { SampleAgentExecutor } from '../sample-agent/agent_executor.js';

// --- Configuration ---

const HTTP_PORT = Number(process.env.HTTP_PORT || 41251);
const GRPC_PORT = Number(process.env.GRPC_PORT || 41252);

// --- Agent Card ---
//
// NOTE: only v1.0 (`A2A_PROTOCOL_VERSION`) interfaces are declared. With
// `legacyCompat: { enabled: true }` set on the well-known agent-card
// handler, requests carrying `A2A-Version: 0.3` (or no header at all,
// which §3.6.2 defaults to `'0.3'`) receive a HYBRID card synthesized
// by the compat layer: the same interface URLs are re-presented under
// the v0.3 protocol version at the card's top level (`url` /
// `preferredTransport` / `additionalInterfaces`), AND the v1.0
// `supportedInterfaces[]` array is left intact. See
// `src/compat/v0_3/server/express/agent_card_handler.ts`.

const compatServerCard: AgentCard = {
  name: 'Compat v1.0 Server',
  description:
    'A v1.0-native A2A server that opts into the v0.3 compat layer on every ' +
    'transport (including push notifications). Accepts both modern ' +
    '(A2A-Version: 1.0) and legacy (A2A-Version: 0.3 or absent) clients on ' +
    'the SAME URLs without any duplication of `supportedInterfaces` entries.',
  supportedInterfaces: [
    {
      url: `http://localhost:${HTTP_PORT}/a2a/jsonrpc`,
      protocolBinding: 'JSONRPC',
      tenant: '',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
    {
      url: `http://localhost:${HTTP_PORT}/a2a/rest`,
      protocolBinding: 'HTTP+JSON',
      tenant: '',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
    {
      url: `localhost:${GRPC_PORT}`,
      protocolBinding: 'GRPC',
      tenant: '',
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
  ],
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples',
  },
  version: '1.0.0',
  capabilities: {
    streaming: true,
    // Required to opt into push notification support. Without this flag,
    // `DefaultRequestHandler` short-circuits every webhook registration
    // and never invokes the sender (see §4.3 of the spec).
    pushNotifications: true,
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
      description:
        'Reuses the SampleAgentExecutor across all transports and across ' +
        'both protocol versions. Publishes task / working / artifact / ' +
        'completed events — enough to exercise the push notification path.',
      tags: ['sample', 'compat', 'v0.3', 'push-notification'],
      examples: ['hi', 'hello', 'how are you'],
      inputModes: ['text'],
      outputModes: ['text', 'task-status'],
      securityRequirements: [],
    },
  ],
  documentationUrl: '',
  signatures: [],
};

async function main() {
  // 1. One TaskStore, one AgentExecutor, one PushNotificationStore, one
  //    sender — shared across every transport AND every protocol
  //    version. The compat layer translates v0.3 ↔ v1.0 on the wire;
  //    the business logic only ever sees v1.0 types.
  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new SampleAgentExecutor();

  // Push notifications: `createLegacyAwarePushNotificationSender`
  // returns a canonical `DefaultPushNotificationSender` seeded with
  // `V1PushNotificationSerializer` for the `'1.0'` wire version AND
  // `V03PushNotificationSerializer` for the `'0.3'` wire version. The
  // store captures `context.requestedVersion` at registration time, so
  // every webhook keeps receiving the wire shape it was originally
  // registered with — even when later events on the same task are
  // triggered by requests on the other transport.
  const pushNotificationStore = new InMemoryPushNotificationStore();
  const pushNotificationSender = createLegacyAwarePushNotificationSender(pushNotificationStore, {
    timeout: 5000,
    tokenHeaderName: 'X-A2A-Notification-Token',
  });

  const requestHandler = new DefaultRequestHandler(
    compatServerCard,
    taskStore,
    agentExecutor,
    undefined, // eventBusManager (use default)
    pushNotificationStore,
    pushNotificationSender
  );

  // 2. Express app: JSON-RPC + REST + AgentCard, every handler with
  //    `legacyCompat: { enabled: true }`.
  const app = express();

  // Agent card: serves a v1.0 card to v1.0 clients and a HYBRID
  // (v0.3 top-level fields + embedded v1.0 `supportedInterfaces`) card
  // to v0.3 clients. `Vary: A2A-Version` ensures HTTP caches keep
  // separate entries per version.
  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({
      agentCardProvider: requestHandler,
      legacyCompat: { enabled: true },
    })
  );

  // JSON-RPC: inspects every incoming body and routes v0.3-shaped
  // requests through `LegacyJsonRpcTransportHandler`, v1.0-shaped
  // requests through the modern handler. Both paths share `requestHandler`.
  app.use(
    '/a2a/jsonrpc',
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
      legacyCompat: { enabled: true },
    })
  );

  // REST: mounts the v0.3 `/v1/...` route set (per the v0.3 reference
  // proto's `google.api.http` annotations) at the SAME mount point as
  // the v1.0 routes. Express's path matcher disambiguates by prefix:
  // `POST /a2a/rest/v1/message:send` → legacy; `POST /a2a/rest/message:send` → v1.0.
  app.use(
    '/a2a/rest',
    restHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
      legacyCompat: { enabled: true },
    })
  );

  // Express's `app.listen` does NOT pass an error to its callback —
  // the callback is registered for the `'listening'` event and takes no
  // arguments. Startup errors (e.g. `EADDRINUSE`) are emitted on the
  // returned server instance via the `'error'` event, so we listen for
  // both explicitly.
  const httpServer = app.listen(HTTP_PORT, () => {
    console.log(`[CompatServer] HTTP server started on http://localhost:${HTTP_PORT}`);
    console.log(`  JSON-RPC : http://localhost:${HTTP_PORT}/a2a/jsonrpc  (v1.0 + v0.3)`);
    console.log(
      `  REST v1.0: http://localhost:${HTTP_PORT}/a2a/rest/message:send  (and other ` +
        `${'`/<operation>`'} routes)`
    );
    console.log(
      `  REST v0.3: http://localhost:${HTTP_PORT}/a2a/rest/v1/message:send  (and other ` +
        `${'`/v1/...`'} routes)`
    );
    console.log(
      `  Card     : http://localhost:${HTTP_PORT}/${AGENT_CARD_PATH}  ` +
        `(hybrid: shape depends on A2A-Version header)`
    );
    console.log(`  Push     : v1.0 webhooks receive application/a2a+json StreamResponse envelopes`);
    console.log(`             v0.3 webhooks receive application/json     bare-event bodies`);
  });
  httpServer.on('error', (err) => {
    console.error('[CompatServer] HTTP server failed to start:', err);
    process.exit(1);
  });

  // 3. gRPC server: register BOTH the v1.0 and v0.3 services on the
  //    same `grpc.Server` instance. The v1.0 gRPC factory intentionally
  //    has no `legacyCompat` opt-in (it would be ambiguous over gRPC,
  //    where the service descriptor itself is the version) — the
  //    canonical way to support v0.3 gRPC clients is to register
  //    `legacyGrpcService` alongside `grpcService`.
  const grpcServer = new Server();
  grpcServer.addService(
    A2AService,
    grpcService({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );
  grpcServer.addService(
    LegacyA2AService,
    legacyGrpcService({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );
  grpcServer.bindAsync(`localhost:${GRPC_PORT}`, ServerCredentials.createInsecure(), (err) => {
    if (err) {
      console.error('[CompatServer] gRPC bind failed:', err);
      return;
    }
    console.log(`[CompatServer] gRPC server started on localhost:${GRPC_PORT}  (v1.0 + v0.3)`);
  });

  console.log('[CompatServer] Press Ctrl+C to stop the server');
}

main().catch(console.error);

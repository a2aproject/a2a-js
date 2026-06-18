/**
 * MOCK v0.3 server fixture — for the compat-v1-client demo ONLY.
 *
 * This file exists so the demo can run end-to-end without the user
 * having to start a real v0.3 server somewhere. It is INTENTIONALLY
 * hand-rolled — every wire response below is a literal JSON template
 * matching the v0.3 JSON-RPC spec verbatim. It does NOT import or use
 * the SDK's v0.3 server modules — `LegacyJsonRpcTransportHandler`
 * (from `@a2a-js/sdk/compat/v0_3/server`), `legacyAgentCardRouter`
 * and `legacyRestRouter` (from `@a2a-js/sdk/compat/v0_3/server/express`),
 * etc. — those exist exclusively to teach the SDK's v1.0 server how
 * to handle incoming v0.3 traffic.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { AGENT_CARD_PATH } from '../../../index.js';

const LEGACY_JSON_CONTENT_TYPE = 'application/json';

// =============================================================================
// v0.3 wire-shape helpers
// =============================================================================

/**
 * v0.3 `AgentCard` — top-level `url`, `preferredTransport`,
 * `protocolVersion`, no `supportedInterfaces[]`. Per the v0.3 spec
 * (https://a2a-protocol.org/v0_3/specification/#5-agent-discovery-the-agent-card).
 */
function buildLegacyAgentCard(baseUrl: string) {
  return {
    name: 'Mock v0.3 Server',
    description:
      'Hand-rolled v0.3 demo fixture for compat-v1-client. NOT a real v0.3 ' +
      'server template — see the header comment in _mock-v0_3-server.ts.',
    url: `${baseUrl}/a2a/jsonrpc`,
    preferredTransport: 'JSONRPC',
    protocolVersion: '0.3',
    version: '0.3.0',
    provider: { organization: 'A2A Samples', url: 'https://example.com/a2a-samples' },
    capabilities: {
      streaming: true,
      pushNotifications: true,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'sample_skill',
        name: 'Sample Skill',
        description: 'Echoes a greeting and publishes a few task status updates.',
        tags: ['demo'],
      },
    ],
  };
}

/**
 * v0.3 `Task` — top-level `id`, `contextId`, `status.state` strings
 * like `'submitted' | 'working' | 'completed'`, parts with `kind:`
 * inner discriminator.
 */
function buildLegacyTask(taskId: string, contextId: string, userText: string) {
  return {
    kind: 'task' as const,
    id: taskId,
    contextId,
    status: {
      state: 'submitted',
      timestamp: new Date().toISOString(),
    },
    history: [
      {
        kind: 'message' as const,
        messageId: uuidv4(),
        role: 'user',
        parts: [{ kind: 'text' as const, text: userText }],
        taskId,
        contextId,
      },
    ],
    artifacts: [] as object[],
  };
}

function buildLegacyStatusUpdate(
  taskId: string,
  contextId: string,
  state: 'working' | 'completed',
  agentText?: string,
  final: boolean = false
) {
  return {
    kind: 'status-update' as const,
    taskId,
    contextId,
    status: {
      state,
      timestamp: new Date().toISOString(),
      ...(agentText
        ? {
            message: {
              kind: 'message' as const,
              messageId: uuidv4(),
              role: 'agent',
              parts: [{ kind: 'text' as const, text: agentText }],
              taskId,
              contextId,
            },
          }
        : {}),
    },
    final,
  };
}

function buildLegacyArtifactUpdate(taskId: string, contextId: string, agentText: string) {
  return {
    kind: 'artifact-update' as const,
    taskId,
    contextId,
    artifact: {
      artifactId: uuidv4(),
      name: 'Result',
      parts: [{ kind: 'text' as const, text: agentText }],
    },
    lastChunk: true,
    append: false,
  };
}

/**
 * Compute the agent's reply text. Mirrors `SampleAgentExecutor` so the
 * compat-v1-client's output is comparable across v1.0 and v0.3 paths.
 */
function replyText(userText: string): string {
  const lower = userText.toLowerCase();
  if (lower.includes('hello') || lower.includes('hi')) return 'Hello World! Nice to meet you!';
  if (lower.includes('how are you'))
    return "I'm doing great! Thanks for asking. How can I help you today?";
  return `Hello World! You said: '${userText}'. Thanks for your message!`;
}

// =============================================================================
// In-memory state
// =============================================================================

interface PushConfig {
  url: string;
  token?: string;
}

/** Map of taskId → list of push notification webhook configs registered for it. */
const pushConfigsByTask = new Map<string, PushConfig[]>();

/**
 * Fire-and-forget POST to every webhook registered for `taskId`. Webhook
 * bodies are bare v0.3 events (no envelope) with `Content-Type:
 * application/json` per the v0.3 spec.
 */
function dispatchWebhooks(taskId: string, event: unknown): void {
  const configs = pushConfigsByTask.get(taskId) ?? [];
  for (const config of configs) {
    const headers: Record<string, string> = { 'Content-Type': LEGACY_JSON_CONTENT_TYPE };
    if (config.token) {
      headers['X-A2A-Notification-Token'] = config.token;
    }
    void fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    }).catch((err) => {
      console.error(`[MockV03Server] webhook delivery failed: ${(err as Error).message}`);
    });
  }
}

// =============================================================================
// JSON-RPC method handlers
// =============================================================================

/**
 * `message/stream` — streaming send. v0.3 spec §6.6. Yields a sequence
 * of v0.3 events; the Express handler wraps each one in an SSE
 * `data:` line.
 *
 * The non-streaming counterpart, `message/send` (v0.3 spec §6.5), is
 * handled inline in the Express dispatcher below so it can register
 * the inline `configuration.pushNotificationConfig` BEFORE dispatching
 * webhooks. Extracting it would force a less-obvious two-pass shape.
 */
function* handleMessageStream(params: {
  message: { messageId: string; parts: { kind?: string; text?: string }[] };
}): Generator<object> {
  const userText = params.message.parts.find((p) => p.kind === 'text')?.text ?? '(no text)';
  const taskId = uuidv4();
  const contextId = uuidv4();
  const reply = replyText(userText);

  yield buildLegacyTask(taskId, contextId, userText);
  yield buildLegacyStatusUpdate(taskId, contextId, 'working', 'Processing your question');
  yield buildLegacyArtifactUpdate(taskId, contextId, reply);
  yield buildLegacyStatusUpdate(taskId, contextId, 'completed', undefined, true);
}

/**
 * `tasks/pushNotificationConfig/set` — v0.3 spec §6.10. Registers a
 * webhook for the given task. We accept the bare config and remember
 * it; future `message/send` calls for that task will POST to it. (For
 * this demo, the client registers the webhook in the same
 * `message/send` request via `configuration.pushNotificationConfig`,
 * so this method is included for completeness but not strictly
 * exercised.)
 */
function handlePushNotificationConfigSet(params?: {
  taskId?: string;
  pushNotificationConfig?: { url?: string; token?: string };
}) {
  const taskId = params?.taskId ?? '';
  if (!taskId || !params?.pushNotificationConfig?.url) {
    return null;
  }
  const list = pushConfigsByTask.get(taskId) ?? [];
  list.push({
    url: params.pushNotificationConfig.url,
    token: params.pushNotificationConfig.token,
  });
  pushConfigsByTask.set(taskId, list);
  return {
    taskId,
    pushNotificationConfig: params.pushNotificationConfig,
  };
}

// =============================================================================
// Express app
// =============================================================================

export interface MockV03ServerOptions {
  port: number;
}

export async function startMockV03Server(options: MockV03ServerOptions): Promise<void> {
  const baseUrl = `http://localhost:${options.port}`;
  const app = express();
  app.use(express.json({ type: LEGACY_JSON_CONTENT_TYPE, limit: '1mb' }));

  // Well-known agent card — v0.3 wire shape, served unconditionally.
  app.get(`/${AGENT_CARD_PATH}`, (_req, res) => {
    res.setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE);
    res.status(200).send(JSON.stringify(buildLegacyAgentCard(baseUrl)));
  });

  // JSON-RPC endpoint — speaks only v0.3 method names.
  app.post('/a2a/jsonrpc', async (req, res) => {
    const body = (req.body ?? {}) as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: unknown;
    };
    const id = body.id ?? null;
    try {
      switch (body.method) {
        case 'message/send': {
          // Register inline pushNotificationConfig from
          // `configuration.pushNotificationConfig`. v0.3 carried it under
          // that exact key, attached to the `MessageSendParams`.
          const params = (body.params ?? {}) as {
            message: { messageId: string; parts: { kind?: string; text?: string }[] };
            configuration?: {
              pushNotificationConfig?: { url?: string; token?: string };
            };
          };
          // We'll compute the taskId before handleMessageSend so we can
          // register the webhook against it.
          const taskId = uuidv4();
          const contextId = uuidv4();
          if (params.configuration?.pushNotificationConfig?.url) {
            pushConfigsByTask.set(taskId, [
              {
                url: params.configuration.pushNotificationConfig.url,
                token: params.configuration.pushNotificationConfig.token,
              },
            ]);
          }
          const userText = params.message.parts.find((p) => p.kind === 'text')?.text ?? '(no text)';
          const reply = replyText(userText);
          const initialTask = buildLegacyTask(taskId, contextId, userText);
          dispatchWebhooks(taskId, initialTask);
          dispatchWebhooks(
            taskId,
            buildLegacyStatusUpdate(taskId, contextId, 'working', 'Processing your question')
          );
          dispatchWebhooks(taskId, buildLegacyArtifactUpdate(taskId, contextId, reply));
          dispatchWebhooks(
            taskId,
            buildLegacyStatusUpdate(taskId, contextId, 'completed', undefined, true)
          );

          const finalTask = {
            ...initialTask,
            status: { state: 'completed', timestamp: new Date().toISOString() },
            artifacts: [
              {
                artifactId: uuidv4(),
                name: 'Result',
                parts: [{ kind: 'text', text: reply }],
              },
            ],
          };
          res.setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE);
          res.status(200).json({ jsonrpc: '2.0', id, result: finalTask });
          return;
        }
        case 'message/stream': {
          const params = (body.params ?? {}) as {
            message: { messageId: string; parts: { kind?: string; text?: string }[] };
          };
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders();
          for (const event of handleMessageStream(params)) {
            res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id, result: event })}\n\n`);
          }
          res.end();
          return;
        }
        case 'tasks/pushNotificationConfig/set': {
          const result = handlePushNotificationConfigSet(
            body.params as {
              taskId?: string;
              pushNotificationConfig?: { url?: string; token?: string };
            }
          );
          res.setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE);
          res.status(200).json({ jsonrpc: '2.0', id, result });
          return;
        }
        default:
          res.setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE);
          res.status(200).json({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${body.method}` },
          });
          return;
      }
    } catch (err) {
      res.setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE);
      res
        .status(500)
        .json({ jsonrpc: '2.0', id, error: { code: -32603, message: (err as Error).message } });
    }
  });

  await new Promise<void>((resolve, reject) => {
    // Express's `app.listen` does NOT pass an error to its callback —
    // the callback is registered for the `'listening'` event and takes
    // no arguments. Startup errors (e.g. `EADDRINUSE`) are emitted on
    // the returned server instance via the `'error'` event.
    const server = app.listen(options.port, () => {
      console.log(`[MockV03Server] In-process mock v0.3 server on ${baseUrl}`);
      resolve();
    });
    server.on('error', reject);
  });
}

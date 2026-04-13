/**
 * Sample: ServerCallContext state headers
 *
 * Demonstrates two patterns for reading request headers inside an AgentExecutor:
 *
 * 1. AUTOMATIC (default builder) - `defaultServerCallContextBuilder` stores all
 *    request headers in `context.state` under `STATE_HEADERS_KEY` with no extra
 *    configuration needed.
 *
 * 2. CUSTOM BUILDER - supply a `contextBuilder` to `jsonRpcHandler` to extract
 *    specific headers and store them in `state` under your own keys, so the
 *    AgentExecutor receives clean, typed values without coupling to raw headers.
 *
 * Run:
 *   cd src/samples && npx tsx authentication/server_call_context.ts
 *
 * Then send a request with a custom header:
 *   curl -X POST http://localhost:41242 \
 *     -H "Content-Type: application/json" \
 *     -H "x-tenant-id: acme-corp" \
 *     -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"messageId":"m1","role":"user","parts":[{"kind":"text","text":"hello"}],"kind":"message"}}}'
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AgentCard } from '../../index.js';
import {
  AgentExecutor,
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryTaskStore,
  RequestContext,
  ServerCallContext,
  ServerCallContextBuilder,
  STATE_HEADERS_KEY,
  RequestHeaders,
  UnauthenticatedUser,
} from '../../server/index.js';
import { jsonRpcHandler } from '../../server/express/index.js';
import { Message } from '../../types.js';
import { Extensions } from '../../extensions.js';
import { User } from '../../server/authentication/user.js';

// --- Custom state keys ---

const STATE_TENANT_ID_KEY = 'tenantId';
const STATE_REQUEST_ID_KEY = 'requestId';

// --- Custom context builder ---

/**
 * Reads well-known headers and stores them as clean typed values in state,
 * alongside the full raw headers stored automatically under STATE_HEADERS_KEY.
 */
const tenantContextBuilder: ServerCallContextBuilder = (
  extensions: Extensions | undefined,
  user: User | undefined,
  headers: RequestHeaders
): ServerCallContext => {
  const state = new Map<string, unknown>([
    // Always include raw headers (mirrors defaultServerCallContextBuilder)
    [STATE_HEADERS_KEY, headers],
    // Extract specific headers into typed state entries
    [STATE_TENANT_ID_KEY, headers['x-tenant-id'] ?? 'unknown'],
    [STATE_REQUEST_ID_KEY, headers['x-request-id'] ?? uuidv4()],
  ]);
  return new ServerCallContext(extensions, user, state);
};

// --- AgentExecutor ---

class StateHeadersAgentExecutor implements AgentExecutor {
  public cancelTask = async (): Promise<void> => {};

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const state = requestContext.context?.state;

    // Pattern 1: read a typed value stored by the custom builder
    const tenantId = state?.get(STATE_TENANT_ID_KEY) as string | undefined;
    const requestId = state?.get(STATE_REQUEST_ID_KEY) as string | undefined;

    // Pattern 2: read a specific header directly from the raw headers map
    const rawHeaders = state?.get(STATE_HEADERS_KEY) as RequestHeaders | undefined;
    const userAgent = rawHeaders?.['user-agent'];

    const lines = [
      `Tenant ID  : ${tenantId ?? '(not set)'}`,
      `Request ID : ${requestId ?? '(not set)'}`,
      `User-Agent : ${userAgent ?? '(not set)'}`,
    ];

    const finalMessage: Message = {
      kind: 'message',
      messageId: uuidv4(),
      role: 'agent',
      parts: [{ kind: 'text', text: lines.join('\n') }],
    };

    eventBus.publish(finalMessage);
  }
}

// --- Server setup ---

const agentCard: AgentCard = {
  name: 'ServerCallContext State Headers Sample',
  description: 'Demonstrates reading request headers from ServerCallContext.state',
  url: 'http://localhost:41242/',
  provider: { organization: 'A2A Samples', url: 'https://example.com' },
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: {},
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [
    {
      id: 'echo_headers',
      name: 'Echo Headers',
      description: 'Echoes x-tenant-id, x-request-id and User-Agent from request headers.',
      tags: ['sample'],
      examples: ['hello'],
      inputModes: ['text'],
      outputModes: ['text'],
    },
  ],
};

async function main() {
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    new StateHeadersAgentExecutor()
  );

  const app = express();
  app.use(express.json());
  app.use(
    jsonRpcHandler({
      requestHandler,
      userBuilder: async () => new UnauthenticatedUser(),
      // Swap contextBuilder to see the difference between custom and default:
      //   custom  → tenantId and requestId are extracted into typed state entries
      //   default → only raw headers are stored under STATE_HEADERS_KEY
      contextBuilder: tenantContextBuilder,
    })
  );

  const PORT = 41242;
  app.listen(PORT, () => {
    console.log(`[StateHeadersSample] Listening on http://localhost:${PORT}`);
    console.log(`[StateHeadersSample] Try:`);
    console.log(
      `  curl -X POST http://localhost:${PORT} \\`,
      `\n    -H "Content-Type: application/json" \\`,
      `\n    -H "x-tenant-id: acme-corp" \\`,
      `\n    -H "x-request-id: req-123" \\`,
      `\n    -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"messageId":"m1","role":"user","parts":[{"kind":"text","text":"hello"}],"kind":"message"}}}'`
    );
  });
}

main().catch(console.error);

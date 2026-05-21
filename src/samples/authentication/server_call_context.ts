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
 *     -d '{"jsonrpc":"2.0","id":"1","method":"SendMessage","params":{"message":{"messageId":"m1","role":"user","parts":[{"kind":"text","text":"hello"}]}}}'
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AgentCard } from '../../index.js';
import { Role } from '../../index.js';
import {
  AgentEvent,
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
import { Message } from '../../index.js';

// --- Custom state keys ---

const STATE_TENANT_ID_KEY = 'tenantId';
const STATE_REQUEST_ID_KEY = 'requestId';

// --- Custom context builder ---

/**
 * Reads well-known headers and stores them as clean typed values in state,
 * alongside the full raw headers stored automatically under STATE_HEADERS_KEY.
 */
const tenantContextBuilder: ServerCallContextBuilder = ({
  extensions,
  user,
  headers,
  requestedVersion,
  tenant,
}): ServerCallContext => {
  const state = new Map<string, unknown>([
    // Always include raw headers (mirrors defaultServerCallContextBuilder)
    [STATE_HEADERS_KEY, headers],
    // Extract specific headers into typed state entries
    [STATE_TENANT_ID_KEY, headers['x-tenant-id'] ?? tenant ?? 'unknown'],
    [STATE_REQUEST_ID_KEY, headers['x-request-id'] ?? uuidv4()],
  ]);
  return new ServerCallContext({
    requestedExtensions: extensions,
    user,
    state,
    requestedVersion,
    tenant,
  });
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
      messageId: uuidv4(),
      contextId: '',
      taskId: '',
      role: Role.ROLE_AGENT,
      parts: [
        {
          content: { $case: 'text', value: lines.join('\n') },
          metadata: undefined,
          filename: '',
          mediaType: '',
        },
      ],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    };

    eventBus.publish(AgentEvent.message(finalMessage));
  }
}

// --- Server setup ---

const agentCard: AgentCard = {
  name: 'ServerCallContext State Headers Sample',
  description: 'Demonstrates reading request headers from ServerCallContext.state',
  supportedInterfaces: [
    {
      url: 'http://localhost:41242/',
      protocolBinding: 'JSONRPC',
      tenant: '',
      protocolVersion: '0.3',
    },
  ],
  provider: { organization: 'A2A Samples', url: 'https://example.com' },
  version: '1.0.0',
  documentationUrl: '',
  capabilities: { streaming: false, pushNotifications: false, extensions: [] },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  signatures: [],
  skills: [
    {
      id: 'echo_headers',
      name: 'Echo Headers',
      description: 'Echoes x-tenant-id, x-request-id and User-Agent from request headers.',
      tags: ['sample'],
      examples: ['hello'],
      inputModes: ['text'],
      outputModes: ['text'],
      securityRequirements: [],
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
      `  curl -X POST http://localhost:${PORT}` +
        ` -H "Content-Type: application/json"` +
        ` -H "x-tenant-id: acme-corp"` +
        ` -H "x-request-id: req-123"` +
        ` -d '{"jsonrpc":"2.0","id":"1","method":"SendMessage","params":{"message":{"messageId":"m1","role":"user","parts":[{"kind":"text","text":"hello"}]}}}'`
    );
  });
}

main().catch(console.error);

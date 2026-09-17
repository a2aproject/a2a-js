import { describe, it, beforeEach, expect } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

import { jsonErrorHandler, jsonRpcHandler } from '../../../src/server/express/json_rpc_handler.js';
import { UserBuilder } from '../../../src/server/express/common.js';
import { DefaultRequestHandler, InMemoryTaskStore, TaskStore } from '../../../src/server/index.js';
import { AgentCard, Role } from '../../../src/index.js';
import { TaskState } from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { AgentEvent } from '../../../src/server/events/execution_event_bus.js';
import { RequestContext } from '../../../src/server/agent_execution/request_context.js';
import { ExecutionEventBus } from '../../../src/server/events/execution_event_bus.js';
import { AgentExecutor } from '../../../src/server/agent_execution/agent_executor.js';
import { HTTP_EXTENSION_HEADER } from '../../../src/constants.js';

// Regression guard: client declares A2A-Extensions, executor activates,
// response header contains the activated set. Exercises the full
// express → jsonRpcHandler → DefaultRequestHandler → executor path
// without stubbing the transport (cf. express_app.spec.ts which spies
// on JsonRpcTransportHandler.handle).
describe('A2A-Extensions response header (end-to-end echo)', () => {
  let app: Express;
  let executor: AgentExecutor;
  let observedContextExtensions: string[] | undefined;

  const ECHOED_EXT = 'https://example.test/ext/echo';
  const SILENT_EXT = 'https://example.test/ext/silent';
  const UNKNOWN_EXT = 'https://example.test/ext/unknown';
  // Narrower than `requested` so tests can distinguish requested / exposed / activated.
  let extensionsToActivate: string[] = [];

  const agentCard: AgentCard = {
    name: 'Extension Echo Agent',
    description: 'Agent that exposes the echo extension.',
    version: '1.0.0',
    provider: undefined,
    documentationUrl: '',
    supportedInterfaces: [
      {
        url: 'http://localhost/a2a',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      extensions: [
        { uri: ECHOED_EXT, required: false, description: '', params: {} },
        { uri: SILENT_EXT, required: false, description: '', params: {} },
      ],
      streaming: false,
      pushNotifications: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };

  beforeEach(() => {
    const taskStore: TaskStore = new InMemoryTaskStore();
    observedContextExtensions = undefined;

    executor = {
      execute: async (ctx: RequestContext, bus: ExecutionEventBus) => {
        observedContextExtensions = ctx.context.requestedExtensions
          ? [...ctx.context.requestedExtensions]
          : [];
        for (const uri of extensionsToActivate) {
          ctx.context.addActivatedExtension(uri);
        }
        bus.publish(
          AgentEvent.task({
            id: ctx.taskId,
            contextId: ctx.contextId,
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              message: undefined,
              timestamp: undefined,
            },
            artifacts: [],
            history: [],
            metadata: {},
          })
        );
        bus.finished();
      },
      cancelTask: async () => {},
    };

    const handler = new DefaultRequestHandler(
      agentCard,
      taskStore,
      executor,
      new DefaultExecutionEventBusManager()
    );

    app = express();
    const router = express.Router();
    router.use(express.json(), jsonErrorHandler);
    router.use(
      jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication })
    );
    app.use(router);
  });

  it('echoes only the activated subset, not the requested set or the exposed set', async () => {
    extensionsToActivate = [ECHOED_EXT];

    const response = await request(app)
      .post('/')
      .set('A2A-Version', '1.0')
      .set(HTTP_EXTENSION_HEADER, `${ECHOED_EXT}, ${SILENT_EXT}`)
      .send({
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'SendMessage',
        params: {
          message: {
            messageId: 'm1',
            role: Role.ROLE_USER,
            parts: [{ text: 'hi' }],
          },
        },
      })
      .expect(200);

    expect(observedContextExtensions).toEqual([ECHOED_EXT, SILENT_EXT]);
    expect(response.get(HTTP_EXTENSION_HEADER)).toBe(ECHOED_EXT);
  });

  it('omits the response header entirely when the executor activates nothing', async () => {
    extensionsToActivate = [];

    const response = await request(app)
      .post('/')
      .set('A2A-Version', '1.0')
      .set(HTTP_EXTENSION_HEADER, ECHOED_EXT)
      .send({
        jsonrpc: '2.0',
        id: 'req-noop',
        method: 'SendMessage',
        params: {
          message: {
            messageId: 'm-noop',
            role: Role.ROLE_USER,
            parts: [{ text: 'hi' }],
          },
        },
      })
      .expect(200);

    expect(response.get(HTTP_EXTENSION_HEADER)).toBeUndefined();
  });

  it('drops extensions the agent does not expose before passing the context to the executor (§4.6.3)', async () => {
    extensionsToActivate = [ECHOED_EXT, UNKNOWN_EXT];

    const response = await request(app)
      .post('/')
      .set('A2A-Version', '1.0')
      .set(HTTP_EXTENSION_HEADER, `${ECHOED_EXT}, ${UNKNOWN_EXT}`)
      .send({
        jsonrpc: '2.0',
        id: 'req-2',
        method: 'SendMessage',
        params: {
          message: {
            messageId: 'm2',
            role: Role.ROLE_USER,
            parts: [{ text: 'hi' }],
          },
        },
      })
      .expect(200);

    // Unknown extensions never reach the executor's requested set.
    expect(observedContextExtensions).toEqual([ECHOED_EXT]);
    // SDK doesn't re-filter on activation — addActivatedExtension accepts any URI.
    // Future tightening should break this assertion deliberately.
    expect(response.get(HTTP_EXTENSION_HEADER)).toBe(`${ECHOED_EXT}, ${UNKNOWN_EXT}`);
  });
});

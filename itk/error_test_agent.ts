/**
 * Minimal A2A agent for error handling verification tests.
 * No ITK dependencies — only exercises the SDK's error response paths.
 */

import express from 'express';
import { AgentCard, AGENT_CARD_PATH, TaskState, Role } from '../src/index.js';
import {
  InMemoryTaskStore,
  AgentExecutor,
  DefaultRequestHandler,
  RequestContext,
  ExecutionEventBus,
  AgentEvent,
} from '../src/server/index.js';
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
  restHandler,
} from '../src/server/express/index.js';
import process from 'process';

class MinimalExecutor implements AgentExecutor {
  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish(
      AgentEvent.task({
        id: context.taskId,
        contextId: context.contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: {
            messageId: 'done',
            parts: [
              {
                content: { $case: 'text', value: 'OK' },
                mediaType: 'text/plain',
                filename: '',
                metadata: {},
              },
            ],
            role: Role.ROLE_AGENT,
            metadata: {},
            contextId: context.contextId,
            taskId: context.taskId,
            extensions: [],
            referenceTaskIds: [],
          },
          timestamp: new Date().toISOString(),
        },
        artifacts: [],
        history: [],
        metadata: {},
      })
    );
    eventBus.finished();
  }

  async cancelTask(_taskId: string, _eventBus: ExecutionEventBus): Promise<void> {}
}

async function main() {
  const args = process.argv.slice(2);
  let httpPort = 10199;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--httpPort' && i + 1 < args.length) {
      httpPort = parseInt(args[i + 1], 10);
      i++;
    }
  }

  const agentCard: AgentCard = {
    name: 'Error Test Agent',
    description: 'Minimal agent for error handling tests.',
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
    },
    supportedInterfaces: [
      {
        url: `http://127.0.0.1:${httpPort}/jsonrpc`,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: `http://127.0.0.1:${httpPort}/rest`,
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    provider: { organization: 'Test', url: '' },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };

  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    new MinimalExecutor()
  );

  const app = express();

  app.use(`/jsonrpc/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(`/rest/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(
    '/jsonrpc',
    jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );
  app.use('/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  app.listen(httpPort, () => {
    console.log(`Error test agent started on http://127.0.0.1:${httpPort}`);
  });
}

main().catch(console.error);

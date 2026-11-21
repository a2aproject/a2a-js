import { describe, expect, it } from 'vitest';

import { RequestMalformedError } from '../../../src/errors/index.js';
import type { A2APlugin, ServerRequest, ServerResponse } from '../../../src/plugins/index.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { DefaultRequestHandler, InMemoryTaskStore } from '../../../src/server/index.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { AgentCard, Role, SendMessageRequest } from '../../../src/types/pb/a2a.js';
import { fakeTaskExecute, MockAgentExecutor } from '../mocks/agent-executor.mock.js';

const card: AgentCard = {
  name: 'Plugin role validation',
  description: 'Checks the request after plugin hooks run',
  version: '1.0.0',
  provider: undefined,
  documentationUrl: '',
  supportedInterfaces: [
    { url: 'http://localhost/a2a', protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '1.0' },
  ],
  capabilities: { extensions: [], streaming: true, pushNotifications: false },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
  signatures: [],
};

describe('message role validation with server plugins', () => {
  it.each([
    ['unary', 'before', Role.ROLE_USER, Role.ROLE_AGENT],
    ['stream', 'before', Role.ROLE_USER, Role.ROLE_AGENT],
    ['unary', 'around', Role.ROLE_USER, Role.ROLE_AGENT],
    ['stream', 'around', Role.ROLE_USER, Role.ROLE_AGENT],
    ['unary', 'before', Role.ROLE_AGENT, Role.ROLE_USER],
    ['stream', 'before', Role.ROLE_AGENT, Role.ROLE_USER],
    ['unary', 'around', Role.ROLE_AGENT, Role.ROLE_USER],
    ['stream', 'around', Role.ROLE_AGENT, Role.ROLE_USER],
  ] as const)(
    '%s checks the role after the %s hook changes %s to %s',
    async (mode, hook, initialRole, effectiveRole) => {
      const executor = new MockAgentExecutor();
      executor.execute.mockImplementation(fakeTaskExecute);
      const responses: ServerResponse[] = [];
      const rewrite = (request: ServerRequest) => {
        (request.payload as SendMessageRequest).message!.role = effectiveRole;
      };
      const plugin: A2APlugin = {
        name: 'rewrite-role',
        ...(hook === 'before'
          ? { beforeHandlerRun: rewrite }
          : {
              aroundHandlerRun: <T>(request: ServerRequest, next: () => T): T => {
                rewrite(request);
                return next();
              },
            }),
        afterHandlerRun: (response) => {
          responses.push(response);
        },
      };
      const handler = new DefaultRequestHandler(
        card,
        new InMemoryTaskStore(),
        executor,
        new DefaultExecutionEventBusManager(),
        undefined,
        undefined,
        undefined,
        undefined,
        { plugins: [plugin] }
      );
      const params: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: 'role-plugin-test',
          role: initialRole,
          parts: [
            { content: { $case: 'text', value: 'hi' }, mediaType: '', filename: '', metadata: {} },
          ],
          contextId: '',
          taskId: '',
          metadata: {},
          extensions: [],
          referenceTaskIds: [],
        },
        configuration: undefined,
        metadata: {},
      };
      const call = async () => {
        if (mode === 'unary') {
          await handler.sendMessage(params, new ServerCallContext());
        } else {
          for await (const event of handler.sendMessageStream(params, new ServerCallContext())) {
            expect(event).toBeDefined();
          }
        }
      };

      if (effectiveRole === Role.ROLE_AGENT) {
        await expect(call()).rejects.toThrow(RequestMalformedError);
        expect(executor.execute).not.toHaveBeenCalled();
        expect(responses.at(-1)?.error).toBeInstanceOf(RequestMalformedError);
      } else {
        await expect(call()).resolves.toBeUndefined();
        expect(executor.execute).toHaveBeenCalledOnce();
        expect(executor.execute.mock.calls[0][0].userMessage.role).toBe(Role.ROLE_USER);
        expect(responses.at(-1)?.error).toBeUndefined();
      }
    }
  );
});

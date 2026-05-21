import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from 'vitest';

import { LegacyJsonRpcTransportHandler } from '../../../../../../src/compat/v0_3/server/transports/jsonrpc/jsonrpc_transport_handler.js';
import { A2AError as LegacyA2AError } from '../../../../../../src/compat/v0_3/server/error.js';
import { A2ARequestHandler } from '../../../../../../src/server/request_handler/a2a_request_handler.js';
import { ServerCallContext } from '../../../../../../src/server/context.js';
import {
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  GenericError,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
} from '../../../../../../src/errors.js';
import { Role, TaskState } from '../../../../../../src/types/pb/a2a.js';
import type {
  AgentCard as V1AgentCard,
  Message as V1Message,
  StreamResponse as V1StreamResponse,
  Task as V1Task,
  TaskPushNotificationConfig as V1TaskPushNotificationConfig,
} from '../../../../../../src/types/pb/a2a.js';
import type * as legacy from '../../../../../../src/compat/v0_3/types/types.js';

describe('LegacyJsonRpcTransportHandler', () => {
  let mockRequestHandler: A2ARequestHandler;
  let transportHandler: LegacyJsonRpcTransportHandler;
  let defaultContext: ServerCallContext;

  const streamingAgentCard: V1AgentCard = {
    name: 'Test',
    description: '',
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: false, extensions: [] },
    defaultInputModes: [],
    defaultOutputModes: [],
    skills: [],
    securityRequirements: [],
    securitySchemes: {},
    provider: undefined,
    signatures: [],
    supportedInterfaces: [
      { url: 'http://x', protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '0.3' },
    ],
    documentationUrl: '',
    iconUrl: '',
  };

  const nonStreamingAgentCard: V1AgentCard = {
    ...streamingAgentCard,
    capabilities: { ...streamingAgentCard.capabilities, streaming: false },
  };

  function sampleV1Message(messageId = 'm-1'): V1Message {
    return {
      messageId,
      contextId: '',
      taskId: '',
      role: Role.ROLE_AGENT,
      parts: [],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    };
  }

  function sampleV1Task(id = 't-1'): V1Task {
    return {
      id,
      contextId: 'ctx',
      status: {
        state: TaskState.TASK_STATE_WORKING,
        message: undefined,
        timestamp: undefined,
      },
      artifacts: [],
      history: [],
      metadata: undefined,
    };
  }

  function sampleV1TaskPushNotificationConfig(): V1TaskPushNotificationConfig {
    return {
      tenant: '',
      id: 'cfg-1',
      taskId: 't-1',
      url: 'https://callback.example.com',
      token: '',
      authentication: undefined,
    };
  }

  beforeEach(() => {
    mockRequestHandler = {
      getAgentCard: vi.fn().mockResolvedValue(streamingAgentCard),
      getAuthenticatedExtendedAgentCard: vi.fn(),
      sendMessage: vi.fn(),
      sendMessageStream: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      createTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfigs: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      resubscribe: vi.fn(),
      listTasks: vi.fn(),
    };
    transportHandler = new LegacyJsonRpcTransportHandler(mockRequestHandler);
    defaultContext = new ServerCallContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Envelope validation', () => {
    it('returns invalid-request for trailing-comma JSON string', async () => {
      const invalidJson = '{ "jsonrpc": "2.0", "method": "tasks/get", "id": 1, }';
      const response = (await transportHandler.handle(
        invalidJson,
        defaultContext
      )) as legacy.JSONRPCErrorResponse;
      expect(response.error.code).toBe(-32600);
    });

    it('returns invalid-request for non-string, non-object body', async () => {
      const response = (await transportHandler.handle(
        123 as unknown as Record<string, unknown>,
        defaultContext
      )) as legacy.JSONRPCErrorResponse;
      expect(response.error.code).toBe(-32600);
      expect(response.error.message).toBe('Invalid request body type.');
    });

    it('returns invalid-request for missing jsonrpc', async () => {
      const response = (await transportHandler.handle(
        { method: 'tasks/get', id: 1, params: { id: 't' } } as Record<string, unknown>,
        defaultContext
      )) as legacy.JSONRPCErrorResponse;
      expect(response.error.code).toBe(-32600);
      expect(response.error.message).toBe('Invalid JSON-RPC Request.');
      expect(response.id).toBe(1);
    });

    it('returns invalid-request for wrong jsonrpc version', async () => {
      const response = (await transportHandler.handle(
        { jsonrpc: '1.0', method: 'tasks/get', id: 1, params: { id: 't' } } as Record<
          string,
          unknown
        >,
        defaultContext
      )) as legacy.JSONRPCErrorResponse;
      expect(response.error.code).toBe(-32600);
    });

    it('returns invalid-request for missing method', async () => {
      const response = (await transportHandler.handle(
        { jsonrpc: '2.0', id: 1 } as Record<string, unknown>,
        defaultContext
      )) as legacy.JSONRPCErrorResponse;
      expect(response.error.code).toBe(-32600);
    });

    it('returns invalid-request for non-string method', async () => {
      const response = (await transportHandler.handle(
        { jsonrpc: '2.0', method: 123, id: 1 } as unknown as Record<string, unknown>,
        defaultContext
      )) as legacy.JSONRPCErrorResponse;
      expect(response.error.code).toBe(-32600);
    });

    it('returns invalid-request for object id', async () => {
      const response = (await transportHandler.handle(
        { jsonrpc: '2.0', method: 'tasks/get', id: {} } as unknown as Record<string, unknown>,
        defaultContext
      )) as legacy.JSONRPCErrorResponse;
      expect(response.error.code).toBe(-32600);
      expect(response.id).toEqual({});
    });

    it('returns invalid-request for float id', async () => {
      const response = (await transportHandler.handle(
        { jsonrpc: '2.0', method: 'tasks/get', id: 1.23 } as Record<string, unknown>,
        defaultContext
      )) as legacy.JSONRPCErrorResponse;
      expect(response.error.code).toBe(-32600);
      expect(response.id).toBe(1.23);
    });

    const invalidParamsCases = [
      { name: 'null', params: null },
      { name: 'undefined', params: undefined },
      { name: 'a string', params: 'invalid' },
      { name: 'an array', params: [1, 2, 3] },
      { name: 'an object with empty key', params: { '': 'invalid' } },
    ];
    invalidParamsCases.forEach(({ name, params }) => {
      it(`returns invalid-params when params are ${name}`, async () => {
        const response = (await transportHandler.handle(
          { jsonrpc: '2.0', method: 'tasks/get', id: 1, params } as Record<string, unknown>,
          defaultContext
        )) as legacy.JSONRPCErrorResponse;
        expect(response.error.code).toBe(-32602);
        expect(response.error.message).toBe('Invalid method parameters.');
        expect(response.id).toBe(1);
      });
    });

    it('accepts agent/getAuthenticatedExtendedCard without params', async () => {
      (mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).mockResolvedValue(
        streamingAgentCard
      );
      const response = (await transportHandler.handle(
        { jsonrpc: '2.0', method: 'agent/getAuthenticatedExtendedCard', id: 1 } as Record<
          string,
          unknown
        >,
        defaultContext
      )) as legacy.JSONRPCSuccessResponse;
      expect(response.result).toBeDefined();
    });
  });

  describe('message/send', () => {
    function buildRequest(extras: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 'req-1',
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'hello' }],
          },
          ...extras,
        },
      };
    }

    it('translates v0.3 params to v1 SendMessageRequest', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(sampleV1Message());
      await transportHandler.handle(buildRequest(), defaultContext);

      const call = (mockRequestHandler.sendMessage as Mock).mock.calls[0][0];
      expect(call.tenant).toBe('');
      expect(call.message.messageId).toBe('msg-1');
      expect(call.message.role).toBe(Role.ROLE_USER);
    });

    it('inverts blocking polarity (blocking=true -> returnImmediately=false)', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(sampleV1Message());
      await transportHandler.handle(
        buildRequest({ configuration: { blocking: true } }),
        defaultContext
      );

      const call = (mockRequestHandler.sendMessage as Mock).mock.calls[0][0];
      expect(call.configuration.returnImmediately).toBe(false);
    });

    it('returns a v0.3 Message envelope when sendMessage returns a Message', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(sampleV1Message('m-out'));
      const response = (await transportHandler.handle(
        buildRequest(),
        defaultContext
      )) as legacy.SendMessageSuccessResponse;

      expect(response.id).toBe('req-1');
      expect(response.jsonrpc).toBe('2.0');
      const result = response.result as legacy.Message1;
      expect(result.kind).toBe('message');
      expect(result.messageId).toBe('m-out');
    });

    it('returns a v0.3 Task envelope when sendMessage returns a Task', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(sampleV1Task('t-out'));
      const response = (await transportHandler.handle(
        buildRequest(),
        defaultContext
      )) as legacy.SendMessageSuccessResponse;

      const result = response.result as legacy.Task2;
      expect(result.kind).toBe('task');
      expect(result.id).toBe('t-out');
    });
  });

  describe('tasks/get', () => {
    it('translates params and wraps the v0.3 Task result', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(sampleV1Task('t-99'));
      const response = (await transportHandler.handle(
        {
          jsonrpc: '2.0',
          method: 'tasks/get',
          id: 7,
          params: { id: 't-99', historyLength: 3 },
        },
        defaultContext
      )) as legacy.GetTaskSuccessResponse;

      const call = (mockRequestHandler.getTask as Mock).mock.calls[0][0];
      expect(call.tenant).toBe('');
      expect(call.id).toBe('t-99');
      expect(call.historyLength).toBe(3);

      expect(response.id).toBe(7);
      expect(response.result.kind).toBe('task');
      expect(response.result.id).toBe('t-99');
    });
  });

  describe('tasks/cancel', () => {
    it('translates params and wraps the v0.3 Task result', async () => {
      (mockRequestHandler.cancelTask as Mock).mockResolvedValue(sampleV1Task('t-c'));
      const response = (await transportHandler.handle(
        {
          jsonrpc: '2.0',
          method: 'tasks/cancel',
          id: 'r',
          params: { id: 't-c' },
        },
        defaultContext
      )) as legacy.CancelTaskSuccessResponse;

      expect((mockRequestHandler.cancelTask as Mock).mock.calls[0][0].id).toBe('t-c');
      expect(response.result.kind).toBe('task');
      expect(response.result.id).toBe('t-c');
    });
  });

  describe('tasks/pushNotificationConfig/set', () => {
    it('translates the v0.3 config and returns a wrapped v0.3 config', async () => {
      (mockRequestHandler.createTaskPushNotificationConfig as Mock).mockResolvedValue(
        sampleV1TaskPushNotificationConfig()
      );
      const response = (await transportHandler.handle(
        {
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/set',
          id: 1,
          params: {
            taskId: 't-1',
            pushNotificationConfig: {
              id: 'cfg-1',
              url: 'https://callback.example.com',
            },
          },
        },
        defaultContext
      )) as legacy.SetTaskPushNotificationConfigSuccessResponse;

      const call = (mockRequestHandler.createTaskPushNotificationConfig as Mock).mock.calls[0][0];
      expect(call.taskId).toBe('t-1');
      expect(call.url).toBe('https://callback.example.com');

      expect(response.result.taskId).toBe('t-1');
      expect(response.result.pushNotificationConfig.url).toBe('https://callback.example.com');
    });
  });

  describe('tasks/pushNotificationConfig/get', () => {
    it('translates params and wraps the v0.3 config', async () => {
      (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockResolvedValue(
        sampleV1TaskPushNotificationConfig()
      );
      const response = (await transportHandler.handle(
        {
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/get',
          id: 1,
          params: { id: 't-1', pushNotificationConfigId: 'cfg-1' },
        },
        defaultContext
      )) as legacy.GetTaskPushNotificationConfigSuccessResponse;

      const call = (mockRequestHandler.getTaskPushNotificationConfig as Mock).mock.calls[0][0];
      expect(call.taskId).toBe('t-1');
      expect(call.id).toBe('cfg-1');

      expect(response.result.taskId).toBe('t-1');
      expect(response.result.pushNotificationConfig.id).toBe('cfg-1');
    });
  });

  describe('tasks/pushNotificationConfig/list', () => {
    it('returns a v0.3 array result', async () => {
      (mockRequestHandler.listTaskPushNotificationConfigs as Mock).mockResolvedValue({
        configs: [sampleV1TaskPushNotificationConfig()],
        nextPageToken: '',
      });
      const response = (await transportHandler.handle(
        {
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/list',
          id: 1,
          params: { id: 't-1' },
        },
        defaultContext
      )) as legacy.ListTaskPushNotificationConfigSuccessResponse;

      const call = (mockRequestHandler.listTaskPushNotificationConfigs as Mock).mock.calls[0][0];
      expect(call.taskId).toBe('t-1');

      expect(Array.isArray(response.result)).toBe(true);
      expect(response.result).toHaveLength(1);
      expect(response.result[0].taskId).toBe('t-1');
    });
  });

  describe('tasks/pushNotificationConfig/delete', () => {
    it('returns null result and forwards translated params', async () => {
      (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockResolvedValue(undefined);
      const response = (await transportHandler.handle(
        {
          jsonrpc: '2.0',
          method: 'tasks/pushNotificationConfig/delete',
          id: 1,
          params: { id: 't-1', pushNotificationConfigId: 'cfg-1' },
        },
        defaultContext
      )) as legacy.JSONRPCSuccessResponse;

      const call = (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mock.calls[0][0];
      expect(call.taskId).toBe('t-1');
      expect(call.id).toBe('cfg-1');
      expect(response.result).toBeNull();
    });
  });

  describe('agent/getAuthenticatedExtendedCard', () => {
    it('returns a v0.3-shaped AgentCard', async () => {
      (mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).mockResolvedValue(
        streamingAgentCard
      );
      const response = (await transportHandler.handle(
        { jsonrpc: '2.0', method: 'agent/getAuthenticatedExtendedCard', id: 1 } as Record<
          string,
          unknown
        >,
        defaultContext
      )) as legacy.GetAuthenticatedExtendedCardSuccessResponse;

      expect(response.result.url).toBe('http://x');
      expect(response.result.protocolVersion).toBe('0.3');
    });
  });

  describe('message/stream', () => {
    it('rejects when streaming is not supported', async () => {
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(nonStreamingAgentCard);
      const response = (await transportHandler.handle(
        {
          jsonrpc: '2.0',
          method: 'message/stream',
          id: 1,
          params: {
            message: {
              kind: 'message',
              messageId: 'm-1',
              role: 'user',
              parts: [{ kind: 'text', text: 'hi' }],
            },
          },
        },
        defaultContext
      )) as legacy.JSONRPCErrorResponse;

      expect(response.error.code).toBe(-32004);
    });

    it('translates each v1 StreamResponse event into a v0.3 envelope', async () => {
      async function* events(): AsyncGenerator<V1StreamResponse, void, undefined> {
        yield { payload: { $case: 'task', value: sampleV1Task('t-s') } };
        yield {
          payload: {
            $case: 'statusUpdate',
            value: {
              taskId: 't-s',
              contextId: 'ctx',
              status: {
                state: TaskState.TASK_STATE_COMPLETED,
                message: undefined,
                timestamp: undefined,
              },
              metadata: undefined,
            },
          },
        };
      }
      (mockRequestHandler.sendMessageStream as Mock).mockReturnValue(events());

      const generator = (await transportHandler.handle(
        {
          jsonrpc: '2.0',
          method: 'message/stream',
          id: 'stream-1',
          params: {
            message: {
              kind: 'message',
              messageId: 'm-1',
              role: 'user',
              parts: [{ kind: 'text', text: 'hi' }],
            },
          },
        },
        defaultContext
      )) as AsyncGenerator<legacy.SendStreamingMessageSuccessResponse, void, undefined>;

      const collected: legacy.SendStreamingMessageSuccessResponse[] = [];
      for await (const event of generator) {
        collected.push(event);
      }
      expect(collected).toHaveLength(2);
      expect(collected[0].id).toBe('stream-1');
      expect((collected[0].result as legacy.Task2).kind).toBe('task');
      expect((collected[1].result as legacy.TaskStatusUpdateEvent).kind).toBe('status-update');
      expect((collected[1].result as legacy.TaskStatusUpdateEvent).final).toBe(true);
    });
  });

  describe('tasks/resubscribe', () => {
    it('translates the v0.3 params and forwards to resubscribe', async () => {
      async function* events(): AsyncGenerator<V1StreamResponse, void, undefined> {
        yield { payload: { $case: 'task', value: sampleV1Task('t-r') } };
      }
      (mockRequestHandler.resubscribe as Mock).mockReturnValue(events());

      const generator = (await transportHandler.handle(
        {
          jsonrpc: '2.0',
          method: 'tasks/resubscribe',
          id: 'r-1',
          params: { id: 't-r' },
        },
        defaultContext
      )) as AsyncGenerator<legacy.SendStreamingMessageSuccessResponse, void, undefined>;

      const collected: legacy.SendStreamingMessageSuccessResponse[] = [];
      for await (const event of generator) {
        collected.push(event);
      }
      const call = (mockRequestHandler.resubscribe as Mock).mock.calls[0][0];
      expect(call.id).toBe('t-r');
      expect(collected).toHaveLength(1);
    });
  });

  describe('Unknown method', () => {
    it('returns method-not-found', async () => {
      const response = (await transportHandler.handle(
        { jsonrpc: '2.0', method: 'no/such/method', id: 1, params: {} },
        defaultContext
      )) as legacy.JSONRPCErrorResponse;
      expect(response.error.code).toBe(-32601);
    });
  });

  describe('Error mapping', () => {
    it('passes through LegacyA2AError unchanged', () => {
      const err = LegacyA2AError.taskNotFound('t-1');
      const mapped = LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError(err);
      expect(mapped.code).toBe(-32001);
      expect(mapped.message).toContain('t-1');
    });

    const v1ToLegacyCodeCases: Array<[Error, number]> = [
      [new TaskNotFoundError('a'), -32001],
      [new TaskNotCancelableError('a'), -32002],
      [new PushNotificationNotSupportedError('a'), -32003],
      [new UnsupportedOperationError('a'), -32004],
      [new ContentTypeNotSupportedError('a'), -32005],
      [new InvalidAgentResponseError('a'), -32006],
      [new ExtendedAgentCardNotConfiguredError('a'), -32007],
      [new ExtensionSupportRequiredError('a'), -32008],
      [new VersionNotSupportedError('a'), -32009],
      [new RequestMalformedError('a'), -32602],
      [new GenericError('a'), -32603],
    ];

    v1ToLegacyCodeCases.forEach(([err, expectedCode]) => {
      it(`maps ${err.name} to code ${expectedCode}`, () => {
        const mapped = LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError(err);
        expect(mapped.code).toBe(expectedCode);
        expect(mapped.message).toBe('a');
      });
    });

    it('omits the data field on v1 SDK errors (v0.3 shape compatibility)', () => {
      const mapped = LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError(
        new TaskNotFoundError('t')
      );
      expect(mapped).not.toHaveProperty('data');
    });

    it('falls back to INTERNAL_ERROR for unknown errors', () => {
      const mapped = LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError(new Error('unexpected'));
      expect(mapped.code).toBe(-32603);
      expect(mapped.message).toBe('unexpected');
    });
  });

  describe('Error surfacing via handle()', () => {
    it('returns a v0.3 error envelope when the request handler throws a v1 SDK error', async () => {
      (mockRequestHandler.getTask as Mock).mockRejectedValue(new TaskNotFoundError('missing'));
      const response = (await transportHandler.handle(
        { jsonrpc: '2.0', method: 'tasks/get', id: 9, params: { id: 'missing' } },
        defaultContext
      )) as legacy.JSONRPCErrorResponse;
      expect(response.error.code).toBe(-32001);
      expect(response.error.message).toBe('missing');
      expect(response.id).toBe(9);
    });
  });
});

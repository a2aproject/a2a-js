import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from 'vitest';

import {
  HTTP_STATUS,
  LegacyRestTransportHandler,
  mapErrorToStatus,
  toLegacyHTTPError,
} from '../../../../../../src/compat/v0_3/server/transports/rest/rest_transport_handler.js';
import { A2AError as LegacyA2AError } from '../../../../../../src/compat/v0_3/server/error.js';
import { A2ARequestHandler } from '../../../../../../src/server/request_handler/a2a_request_handler.js';
import { ServerCallContext } from '../../../../../../src/server/context.js';
import {
  A2AError,
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  InvalidAgentResponseError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
} from '../../../../../../src/errors/index.js';
import { Role, TaskState } from '../../../../../../src/types/pb/a2a.js';
import type {
  AgentCard as V1AgentCard,
  Message as V1Message,
  StreamResponse as V1StreamResponse,
  Task as V1Task,
  TaskPushNotificationConfig as V1TaskPushNotificationConfig,
} from '../../../../../../src/types/pb/a2a.js';
import type * as legacy from '../../../../../../src/compat/v0_3/types/types.js';

describe('LegacyRestTransportHandler', () => {
  let mockRequestHandler: A2ARequestHandler;
  let transportHandler: LegacyRestTransportHandler;
  let defaultContext: ServerCallContext;

  const streamingAgentCard: V1AgentCard = {
    name: 'Test',
    description: '',
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: true, extensions: [] },
    defaultInputModes: [],
    defaultOutputModes: [],
    skills: [],
    securityRequirements: [],
    securitySchemes: {},
    provider: undefined,
    signatures: [],
    supportedInterfaces: [
      { url: 'http://x', protocolBinding: 'HTTP+JSON', tenant: '', protocolVersion: '0.3' },
    ],
    documentationUrl: '',
    iconUrl: '',
  };

  const nonStreamingAgentCard: V1AgentCard = {
    ...streamingAgentCard,
    capabilities: { ...streamingAgentCard.capabilities, streaming: false },
  };

  const noPushAgentCard: V1AgentCard = {
    ...streamingAgentCard,
    capabilities: { ...streamingAgentCard.capabilities, pushNotifications: false },
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

  function sampleLegacyMessageSendParams(messageId = 'msg-1'): legacy.MessageSendParams {
    return {
      message: {
        kind: 'message',
        messageId,
        role: 'user',
        parts: [{ kind: 'text', text: 'hello' }],
      },
    };
  }

  function sampleLegacyTaskPushNotificationConfig(): legacy.TaskPushNotificationConfig {
    return {
      taskId: 't-1',
      pushNotificationConfig: {
        id: 'cfg-1',
        url: 'https://callback.example.com',
      },
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
    transportHandler = new LegacyRestTransportHandler(mockRequestHandler);
    defaultContext = new ServerCallContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // HTTP status mapping
  // ==========================================================================

  describe('mapErrorToStatus', () => {
    it('maps TaskNotFoundError to 404', () => {
      expect(mapErrorToStatus(new TaskNotFoundError('x'))).toBe(HTTP_STATUS.NOT_FOUND);
    });
    it('maps RequestMalformedError to 400', () => {
      expect(mapErrorToStatus(new RequestMalformedError('x'))).toBe(HTTP_STATUS.BAD_REQUEST);
    });
    it('maps unknown errors to 500', () => {
      expect(mapErrorToStatus(new Error('???'))).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    });

    it('maps LegacyA2AError.invalidParams (-32602) to 400', () => {
      expect(mapErrorToStatus(LegacyA2AError.invalidParams('bad'))).toBe(HTTP_STATUS.BAD_REQUEST);
    });
    it('maps LegacyA2AError.invalidRequest (-32600) to 400', () => {
      expect(mapErrorToStatus(LegacyA2AError.invalidRequest('bad'))).toBe(HTTP_STATUS.BAD_REQUEST);
    });
    it('maps LegacyA2AError.parseError (-32700) to 400', () => {
      expect(mapErrorToStatus(LegacyA2AError.parseError('bad'))).toBe(HTTP_STATUS.BAD_REQUEST);
    });
    it('maps LegacyA2AError.methodNotFound (-32601) to 501', () => {
      expect(mapErrorToStatus(LegacyA2AError.methodNotFound('x'))).toBe(
        HTTP_STATUS.NOT_IMPLEMENTED
      );
    });
    it('maps LegacyA2AError.taskNotFound (-32001) to 404', () => {
      expect(mapErrorToStatus(LegacyA2AError.taskNotFound('t'))).toBe(HTTP_STATUS.NOT_FOUND);
    });
    it('maps LegacyA2AError.internalError (-32603) to 500', () => {
      expect(mapErrorToStatus(LegacyA2AError.internalError('x'))).toBe(
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    });
  });

  // ==========================================================================
  // Error body shape
  // ==========================================================================

  describe('toLegacyHTTPError / mapToLegacyHTTPError', () => {
    it('passes through LegacyA2AError unchanged', () => {
      const err = LegacyA2AError.taskNotFound('t-1');
      const body = toLegacyHTTPError(err);
      expect(body.code).toBe(-32001);
      expect(body.message).toContain('t-1');
    });

    it('includes data field when LegacyA2AError carries data', () => {
      const err = LegacyA2AError.invalidParams('boom', { hint: 'check x' });
      const body = toLegacyHTTPError(err);
      expect(body.code).toBe(-32602);
      expect(body.data).toEqual({ hint: 'check x' });
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
      [new A2AError('a'), -32603],
    ];

    v1ToLegacyCodeCases.forEach(([err, expectedCode]) => {
      it(`maps ${err.name} to code ${expectedCode}`, () => {
        const body = toLegacyHTTPError(err);
        expect(body.code).toBe(expectedCode);
        expect(body.message).toBe('a');
      });
    });

    it('omits the data field on v1 SDK errors (v0.3 shape compatibility)', () => {
      const body = toLegacyHTTPError(new TaskNotFoundError('t'));
      expect(body).not.toHaveProperty('data');
    });

    it('produces a bare body without an outer error wrapper or details array', () => {
      const body = toLegacyHTTPError(new TaskNotFoundError('t'));
      expect(body).not.toHaveProperty('error');
      expect(body).not.toHaveProperty('details');
      expect(body).not.toHaveProperty('status');
      expect(Object.keys(body).sort()).toEqual(['code', 'message']);
    });

    it('falls back to INTERNAL_ERROR for unknown errors', () => {
      const body = toLegacyHTTPError(new Error('unexpected'));
      expect(body.code).toBe(-32603);
      expect(body.message).toBe('unexpected');
    });

    it('exposes the same mapping via the static method', () => {
      const a = toLegacyHTTPError(new TaskNotFoundError('t'));
      const b = LegacyRestTransportHandler.mapToLegacyHTTPError(new TaskNotFoundError('t'));
      expect(a).toEqual(b);
    });
  });

  // ==========================================================================
  // sendMessage
  // ==========================================================================

  describe('sendMessage', () => {
    it('translates v0.3 params to a v1 SendMessageRequest', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(sampleV1Message());
      await transportHandler.sendMessage(sampleLegacyMessageSendParams(), defaultContext);

      const call = (mockRequestHandler.sendMessage as Mock).mock.calls[0][0];
      expect(call.tenant).toBe('');
      expect(call.message.messageId).toBe('msg-1');
      expect(call.message.role).toBe(Role.ROLE_USER);
    });

    it('returns a v0.3 Message envelope when sendMessage returns a Message', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(sampleV1Message('m-out'));
      const result = (await transportHandler.sendMessage(
        sampleLegacyMessageSendParams(),
        defaultContext
      )) as legacy.Message;
      expect(result.kind).toBe('message');
      expect(result.messageId).toBe('m-out');
    });

    it('returns a v0.3 Task envelope when sendMessage returns a Task', async () => {
      (mockRequestHandler.sendMessage as Mock).mockResolvedValue(sampleV1Task('t-out'));
      const result = (await transportHandler.sendMessage(
        sampleLegacyMessageSendParams(),
        defaultContext
      )) as legacy.Task;
      expect(result.kind).toBe('task');
      expect(result.id).toBe('t-out');
    });

    it('rejects when message is missing', async () => {
      await expect(
        transportHandler.sendMessage(
          { message: undefined as unknown as legacy.Message },
          defaultContext
        )
      ).rejects.toBeInstanceOf(LegacyA2AError);
    });

    it('rejects when message.messageId is missing', async () => {
      await expect(
        transportHandler.sendMessage(
          {
            message: {
              kind: 'message',
              messageId: '',
              role: 'user',
              parts: [],
            },
          },
          defaultContext
        )
      ).rejects.toMatchObject({ name: 'RequestMalformedError' });
    });
  });

  // ==========================================================================
  // sendMessageStream
  // ==========================================================================

  describe('sendMessageStream', () => {
    it('rejects when streaming is not supported', async () => {
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(nonStreamingAgentCard);
      await expect(
        transportHandler.sendMessageStream(sampleLegacyMessageSendParams(), defaultContext)
      ).rejects.toMatchObject({ name: 'UnsupportedOperationError' });
    });

    it('translates each v1 StreamResponse event into a v0.3 result payload', async () => {
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

      const generator = await transportHandler.sendMessageStream(
        sampleLegacyMessageSendParams(),
        defaultContext
      );
      const collected: legacy.SendStreamingMessageSuccessResponse['result'][] = [];
      for await (const event of generator) {
        collected.push(event);
      }
      expect(collected).toHaveLength(2);
      expect((collected[0] as legacy.Task).kind).toBe('task');
      expect((collected[1] as legacy.TaskStatusUpdateEvent).kind).toBe('status-update');
      expect((collected[1] as legacy.TaskStatusUpdateEvent).final).toBe(true);
    });
  });

  // ==========================================================================
  // getTask
  // ==========================================================================

  describe('getTask', () => {
    it('translates params and returns the v0.3 Task', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(sampleV1Task('t-99'));
      const result = await transportHandler.getTask('t-99', defaultContext, '3');
      const call = (mockRequestHandler.getTask as Mock).mock.calls[0][0];
      expect(call.tenant).toBe('');
      expect(call.id).toBe('t-99');
      expect(call.historyLength).toBe(3);

      expect(result.kind).toBe('task');
      expect(result.id).toBe('t-99');
    });

    it('leaves historyLength absent when not provided (full-history semantics per §3.2.4)', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(sampleV1Task('t-2'));
      await transportHandler.getTask('t-2', defaultContext);
      const call = (mockRequestHandler.getTask as Mock).mock.calls[0][0];
      // undefined means "no client limit, return full history"; coercing
      // the default to 0 would silently flip semantics to "no history".
      expect(call.historyLength).toBeUndefined();
    });

    it('passes historyLength = 0 through when the client explicitly requests no history', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(sampleV1Task('t-3'));
      await transportHandler.getTask('t-3', defaultContext, '0');
      const call = (mockRequestHandler.getTask as Mock).mock.calls[0][0];
      expect(call.historyLength).toBe(0);
    });

    it('passes historyLength = N through for N > 0', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(sampleV1Task('t-4'));
      await transportHandler.getTask('t-4', defaultContext, '7');
      const call = (mockRequestHandler.getTask as Mock).mock.calls[0][0];
      expect(call.historyLength).toBe(7);
    });

    it('forwards context.tenant when supplied', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(sampleV1Task('t-5'));
      const tenantContext = new ServerCallContext({ tenant: 'tenant-x' });
      await transportHandler.getTask('t-5', tenantContext);
      const call = (mockRequestHandler.getTask as Mock).mock.calls[0][0];
      expect(call.tenant).toBe('tenant-x');
    });

    it('rejects an invalid historyLength (non-numeric)', async () => {
      await expect(transportHandler.getTask('t-1', defaultContext, 'abc')).rejects.toMatchObject({
        name: 'RequestMalformedError',
      });
    });

    it('rejects a negative historyLength', async () => {
      await expect(transportHandler.getTask('t-1', defaultContext, '-2')).rejects.toMatchObject({
        name: 'RequestMalformedError',
      });
    });
  });

  // ==========================================================================
  // cancelTask
  // ==========================================================================

  describe('cancelTask', () => {
    it('returns the canceled v0.3 Task', async () => {
      (mockRequestHandler.cancelTask as Mock).mockResolvedValue(sampleV1Task('t-c'));
      const result = await transportHandler.cancelTask('t-c', defaultContext);
      expect((mockRequestHandler.cancelTask as Mock).mock.calls[0][0].id).toBe('t-c');
      expect(result.kind).toBe('task');
      expect(result.id).toBe('t-c');
    });
  });

  // ==========================================================================
  // resubscribe
  // ==========================================================================

  describe('resubscribe', () => {
    it('rejects when streaming is not supported', async () => {
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(nonStreamingAgentCard);
      await expect(transportHandler.resubscribe('t-1', defaultContext)).rejects.toMatchObject({
        name: 'UnsupportedOperationError',
      });
    });

    it('forwards the task id and translates events', async () => {
      async function* events(): AsyncGenerator<V1StreamResponse, void, undefined> {
        yield { payload: { $case: 'task', value: sampleV1Task('t-r') } };
      }
      (mockRequestHandler.resubscribe as Mock).mockReturnValue(events());

      const generator = await transportHandler.resubscribe('t-r', defaultContext);
      const collected: legacy.SendStreamingMessageSuccessResponse['result'][] = [];
      for await (const event of generator) {
        collected.push(event);
      }
      const call = (mockRequestHandler.resubscribe as Mock).mock.calls[0][0];
      expect(call.id).toBe('t-r');
      expect(collected).toHaveLength(1);
      expect((collected[0] as legacy.Task).kind).toBe('task');
    });
  });

  // ==========================================================================
  // setTaskPushNotificationConfig
  // ==========================================================================

  describe('setTaskPushNotificationConfig', () => {
    it('rejects when push notifications are not supported', async () => {
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue(noPushAgentCard);
      await expect(
        transportHandler.setTaskPushNotificationConfig(
          sampleLegacyTaskPushNotificationConfig(),
          defaultContext
        )
      ).rejects.toMatchObject({ name: 'PushNotificationNotSupportedError' });
    });

    it('rejects when taskId is missing', async () => {
      await expect(
        transportHandler.setTaskPushNotificationConfig(
          {
            taskId: '',
            pushNotificationConfig: { url: 'http://x' },
          },
          defaultContext
        )
      ).rejects.toMatchObject({ name: 'RequestMalformedError' });
    });

    it('rejects when pushNotificationConfig is missing', async () => {
      await expect(
        transportHandler.setTaskPushNotificationConfig(
          {
            taskId: 't-1',
            pushNotificationConfig: undefined as unknown as legacy.PushNotificationConfig1,
          },
          defaultContext
        )
      ).rejects.toMatchObject({ name: 'RequestMalformedError' });
    });

    it('translates the v0.3 config and returns a v0.3 config', async () => {
      (mockRequestHandler.createTaskPushNotificationConfig as Mock).mockResolvedValue(
        sampleV1TaskPushNotificationConfig()
      );
      const result = await transportHandler.setTaskPushNotificationConfig(
        sampleLegacyTaskPushNotificationConfig(),
        defaultContext
      );
      const call = (mockRequestHandler.createTaskPushNotificationConfig as Mock).mock.calls[0][0];
      expect(call.taskId).toBe('t-1');
      expect(call.url).toBe('https://callback.example.com');

      expect(result.taskId).toBe('t-1');
      expect(result.pushNotificationConfig.url).toBe('https://callback.example.com');
    });
  });

  // ==========================================================================
  // listTaskPushNotificationConfigs
  // ==========================================================================

  describe('listTaskPushNotificationConfigs', () => {
    it('returns a v0.3 array of configs', async () => {
      (mockRequestHandler.listTaskPushNotificationConfigs as Mock).mockResolvedValue({
        configs: [sampleV1TaskPushNotificationConfig()],
        nextPageToken: '',
      });
      const result = await transportHandler.listTaskPushNotificationConfigs('t-1', defaultContext);
      const call = (mockRequestHandler.listTaskPushNotificationConfigs as Mock).mock.calls[0][0];
      expect(call.taskId).toBe('t-1');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe('t-1');
    });
  });

  // ==========================================================================
  // getTaskPushNotificationConfig
  // ==========================================================================

  describe('getTaskPushNotificationConfig', () => {
    it('translates params and returns the v0.3 config', async () => {
      (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockResolvedValue(
        sampleV1TaskPushNotificationConfig()
      );
      const result = await transportHandler.getTaskPushNotificationConfig(
        't-1',
        'cfg-1',
        defaultContext
      );
      const call = (mockRequestHandler.getTaskPushNotificationConfig as Mock).mock.calls[0][0];
      expect(call.taskId).toBe('t-1');
      expect(call.id).toBe('cfg-1');

      expect(result.taskId).toBe('t-1');
      expect(result.pushNotificationConfig.id).toBe('cfg-1');
    });
  });

  // ==========================================================================
  // deleteTaskPushNotificationConfig
  // ==========================================================================

  describe('deleteTaskPushNotificationConfig', () => {
    it('forwards translated params and returns void', async () => {
      (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockResolvedValue(undefined);
      const result = await transportHandler.deleteTaskPushNotificationConfig(
        't-1',
        'cfg-1',
        defaultContext
      );
      const call = (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mock.calls[0][0];
      expect(call.taskId).toBe('t-1');
      expect(call.id).toBe('cfg-1');
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // getAuthenticatedExtendedAgentCard
  // ==========================================================================

  describe('getAuthenticatedExtendedAgentCard', () => {
    it('returns a v0.3-shaped AgentCard', async () => {
      (mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).mockResolvedValue(
        streamingAgentCard
      );
      const result = await transportHandler.getAuthenticatedExtendedAgentCard(defaultContext);
      expect(result.url).toBe('http://x');
      expect(result.protocolVersion).toBe('0.3');
    });
  });
});

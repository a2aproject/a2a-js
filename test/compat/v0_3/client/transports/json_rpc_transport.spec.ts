import { describe, it, beforeEach, expect, vi, type Mock } from 'vitest';
import { formatSSEEvent } from '../../../../../src/sse_utils.js';
import {
  A2A_ERROR_CODE,
  JSONRPCTransportError,
  TaskNotFoundError,
} from '../../../../../src/errors.js';
import { LegacyJsonRpcTransport } from '../../../../../src/compat/v0_3/client/transports/json_rpc_transport.js';
import {
  Role,
  TaskState,
  type SendMessageRequest as V1SendMessageRequest,
  type GetTaskRequest as V1GetTaskRequest,
  type CancelTaskRequest as V1CancelTaskRequest,
  type TaskPushNotificationConfig as V1TaskPushNotificationConfig,
  type GetTaskPushNotificationConfigRequest as V1GetTaskPushNotificationConfigRequest,
  type ListTaskPushNotificationConfigsRequest as V1ListTaskPushNotificationConfigsRequest,
  type DeleteTaskPushNotificationConfigRequest as V1DeleteTaskPushNotificationConfigRequest,
  type SubscribeToTaskRequest as V1SubscribeToTaskRequest,
} from '../../../../../src/types/pb/a2a.js';

const ENDPOINT = 'https://test.example/api';

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeSseResponse(events: object[]): Response {
  const body = events.map((event) => formatSSEEvent(event)).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function sendMessageRequest(): V1SendMessageRequest {
  return {
    tenant: '',
    message: {
      messageId: 'msg-1',
      contextId: '',
      taskId: '',
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: 'text', value: 'hi' },
          filename: '',
          mediaType: '',
          metadata: undefined,
        },
      ],
      extensions: [],
      metadata: undefined,
      referenceTaskIds: [],
    },
    configuration: undefined,
    metadata: {},
  };
}

describe('LegacyJsonRpcTransport', () => {
  let transport: LegacyJsonRpcTransport;
  let mockFetch: Mock<typeof fetch>;

  beforeEach(() => {
    mockFetch = vi.fn();
    transport = new LegacyJsonRpcTransport({
      endpoint: ENDPOINT,
      fetchImpl: mockFetch,
    });
  });

  describe('metadata', () => {
    it("protocolName is 'JSONRPC'", () => {
      expect(transport.protocolName).toBe('JSONRPC');
    });

    it("protocolVersion is '0.3'", () => {
      expect(transport.protocolVersion).toBe('0.3');
    });
  });

  describe('sendMessage', () => {
    it('emits a v0.3 message/send envelope with application/json content type', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: {
            kind: 'task',
            id: 't-1',
            contextId: 'ctx-1',
            status: { state: 'working' },
          },
        })
      );

      const result = await transport.sendMessage(sendMessageRequest());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(ENDPOINT);
      const init2 = init as RequestInit;
      expect(init2.method).toBe('POST');
      const headers = init2.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');

      const body = JSON.parse(init2.body as string);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('message/send');
      expect(body.id).toBe(1);
      expect(body.params.message.kind).toBe('message');
      expect(body.params.message.role).toBe('user');

      // Result is translated back into v1 proto with kind discriminator stripped.
      expect('messageId' in result).toBe(false);
      expect('id' in result && (result as { id: string }).id).toBe('t-1');
    });

    it('translates a v0.3 message-shaped response into a v1 Message', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: {
            kind: 'message',
            messageId: 'msg-resp',
            role: 'agent',
            parts: [],
          },
        })
      );

      const result = await transport.sendMessage(sendMessageRequest());
      expect('messageId' in result && (result as { messageId: string }).messageId).toBe('msg-resp');
    });
  });

  describe('getTask', () => {
    it('emits tasks/get and translates the v0.3 Task to v1 proto', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: {
            kind: 'task',
            id: 't-1',
            contextId: 'ctx-1',
            status: { state: 'completed' },
          },
        })
      );

      const req: V1GetTaskRequest = { tenant: '', id: 't-1', historyLength: 5 };
      const task = await transport.getTask(req);

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.method).toBe('tasks/get');
      expect(body.params).toEqual({ id: 't-1', historyLength: 5 });
      expect(task.id).toBe('t-1');
      expect(task.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    });
  });

  describe('cancelTask', () => {
    it('emits tasks/cancel and translates the v0.3 Task to v1 proto', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: {
            kind: 'task',
            id: 't-1',
            contextId: 'ctx-1',
            status: { state: 'canceled' },
          },
        })
      );

      const req: V1CancelTaskRequest = { tenant: '', id: 't-1', metadata: undefined };
      const task = await transport.cancelTask(req);

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.method).toBe('tasks/cancel');
      expect(body.params).toEqual({ id: 't-1' });
      expect(task.id).toBe('t-1');
    });
  });

  describe('push notification configs', () => {
    function v1PushConfig(): V1TaskPushNotificationConfig {
      return {
        tenant: '',
        id: 'cfg-1',
        taskId: 'task-1',
        url: 'https://webhook.example/notify',
        token: 'tok',
        authentication: undefined,
      };
    }

    it('createTaskPushNotificationConfig uses tasks/pushNotificationConfig/set', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: {
            taskId: 'task-1',
            pushNotificationConfig: {
              id: 'cfg-1',
              url: 'https://webhook.example/notify',
              token: 'tok',
            },
          },
        })
      );

      const result = await transport.createTaskPushNotificationConfig(v1PushConfig());

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfig/set');
      expect(body.params).toEqual({
        taskId: 'task-1',
        pushNotificationConfig: {
          id: 'cfg-1',
          url: 'https://webhook.example/notify',
          token: 'tok',
        },
      });
      expect(result.id).toBe('cfg-1');
      expect(result.taskId).toBe('task-1');
    });

    it('getTaskPushNotificationConfig uses tasks/pushNotificationConfig/get', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: {
            taskId: 'task-1',
            pushNotificationConfig: {
              id: 'cfg-1',
              url: 'https://webhook.example/notify',
              token: 'tok',
            },
          },
        })
      );

      const req: V1GetTaskPushNotificationConfigRequest = {
        tenant: '',
        taskId: 'task-1',
        id: 'cfg-1',
      };
      const result = await transport.getTaskPushNotificationConfig(req);

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfig/get');
      expect(body.params).toEqual({ id: 'task-1', pushNotificationConfigId: 'cfg-1' });
      expect(result.id).toBe('cfg-1');
    });

    it('listTaskPushNotificationConfig uses tasks/pushNotificationConfig/list', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: [
            {
              taskId: 'task-1',
              pushNotificationConfig: {
                id: 'cfg-1',
                url: 'https://webhook.example/notify',
                token: 'tok',
              },
            },
          ],
        })
      );

      const req: V1ListTaskPushNotificationConfigsRequest = {
        tenant: '',
        taskId: 'task-1',
        pageSize: 0,
        pageToken: '',
      };
      const result = await transport.listTaskPushNotificationConfig(req);

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfig/list');
      expect(body.params).toEqual({ id: 'task-1' });
      expect(result.configs).toHaveLength(1);
      expect(result.configs[0]!.id).toBe('cfg-1');
    });

    it('deleteTaskPushNotificationConfig uses tasks/pushNotificationConfig/delete', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: null,
        })
      );

      const req: V1DeleteTaskPushNotificationConfigRequest = {
        tenant: '',
        taskId: 'task-1',
        id: 'cfg-1',
      };
      await transport.deleteTaskPushNotificationConfig(req);

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfig/delete');
      expect(body.params).toEqual({ id: 'task-1', pushNotificationConfigId: 'cfg-1' });
    });
  });

  describe('getExtendedAgentCard', () => {
    it('emits agent/getAuthenticatedExtendedCard and translates the v0.3 AgentCard', async () => {
      const legacyCard: Record<string, unknown> = {
        name: 'My Agent',
        description: 'desc',
        version: '1.2.3',
        url: 'https://agent.example/json-rpc',
        preferredTransport: 'JSONRPC',
        protocolVersion: '0.3',
        capabilities: {},
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [],
      };
      mockFetch.mockResolvedValue(makeJsonResponse({ jsonrpc: '2.0', id: 1, result: legacyCard }));

      const card = await transport.getExtendedAgentCard({ tenant: '' });

      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.method).toBe('agent/getAuthenticatedExtendedCard');
      expect(card.name).toBe('My Agent');
      // Primary interface lifted out of the card-level (url, preferredTransport).
      expect(card.supportedInterfaces[0]!.url).toBe('https://agent.example/json-rpc');
      expect(card.supportedInterfaces[0]!.protocolBinding).toBe('JSONRPC');
      expect(card.supportedInterfaces[0]!.protocolVersion).toBe('0.3');
    });
  });

  describe('listTasks', () => {
    it('throws JSONRPCTransportError with METHOD_NOT_FOUND and never calls fetch', async () => {
      await expect(
        transport.listTasks({
          tenant: '',
          contextId: '',
          status: TaskState.TASK_STATE_UNSPECIFIED,
          pageSize: 0,
          pageToken: '',
          historyLength: 0,
          statusTimestampAfter: '',
          includeArtifacts: false,
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(JSONRPCTransportError);
        const transportError = err as JSONRPCTransportError;
        expect(transportError.errorResponse.error.code).toBe(A2A_ERROR_CODE.METHOD_NOT_FOUND);
        expect(transportError.errorResponse.error.message).toContain('Method not found');
        expect(transportError.errorResponse.error.message).toContain('tasks/list');
        return true;
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('error envelope mapping', () => {
    it('maps -32001 TASK_NOT_FOUND to TaskNotFoundError', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: A2A_ERROR_CODE.TASK_NOT_FOUND, message: 'no such task' },
        })
      );

      await expect(
        transport.getTask({ tenant: '', id: 't-x', historyLength: 0 })
      ).rejects.toBeInstanceOf(TaskNotFoundError);
    });

    it('falls through unknown codes to JSONRPCTransportError', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -42000, message: 'mystery' },
        })
      );

      await expect(
        transport.getTask({ tenant: '', id: 't-x', historyLength: 0 })
      ).rejects.toBeInstanceOf(JSONRPCTransportError);
    });
  });

  describe('streaming', () => {
    it('translates v0.3 SSE events into v1 StreamResponse payloads', async () => {
      const events: Record<string, unknown>[] = [
        {
          jsonrpc: '2.0',
          id: 1,
          result: {
            kind: 'task',
            id: 't-1',
            contextId: 'ctx-1',
            status: { state: 'submitted' },
          },
        },
        {
          jsonrpc: '2.0',
          id: 1,
          result: {
            kind: 'status-update',
            taskId: 't-1',
            contextId: 'ctx-1',
            final: false,
            status: { state: 'working' },
          },
        },
        {
          jsonrpc: '2.0',
          id: 1,
          result: {
            kind: 'artifact-update',
            taskId: 't-1',
            contextId: 'ctx-1',
            artifact: {
              artifactId: 'a-1',
              parts: [],
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 1,
          result: {
            kind: 'message',
            messageId: 'm-1',
            role: 'agent',
            parts: [],
          },
        },
      ];
      mockFetch.mockResolvedValue(makeSseResponse(events));

      const received = [];
      for await (const value of transport.sendMessageStream(sendMessageRequest())) {
        received.push(value);
      }

      expect(received).toHaveLength(4);
      expect(received[0]!.payload?.$case).toBe('task');
      expect(received[1]!.payload?.$case).toBe('statusUpdate');
      expect(received[2]!.payload?.$case).toBe('artifactUpdate');
      expect(received[3]!.payload?.$case).toBe('message');

      // Verify the streaming request was made with text/event-stream Accept header
      // and the streaming-specific v0.3 method name.
      const [, init] = mockFetch.mock.calls[0]!;
      const init2 = init as RequestInit;
      const headers = init2.headers as Record<string, string>;
      expect(headers['Accept']).toBe('text/event-stream');
      const body = JSON.parse(init2.body as string);
      expect(body.method).toBe('message/stream');
    });

    it('uses tasks/resubscribe for resubscribeTask', async () => {
      mockFetch.mockResolvedValue(makeSseResponse([]));

      const req: V1SubscribeToTaskRequest = { tenant: '', id: 't-1' };
      // Drain the iterator to trigger the request.
      const events = [];
      for await (const event of transport.resubscribeTask(req)) {
        events.push(event);
      }
      expect(events).toHaveLength(0);

      const [, init] = mockFetch.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.method).toBe('tasks/resubscribe');
      expect(body.params).toEqual({ id: 't-1' });
    });
  });

  describe('service parameters / headers', () => {
    it('forwards serviceParameters headers to fetch', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: { kind: 'task', id: 't-1', contextId: 'c', status: { state: 'working' } },
        })
      );

      await transport.getTask(
        { tenant: '', id: 't-1', historyLength: 0 },
        { serviceParameters: { 'A2A-Version': '0.3', 'X-Custom': 'yes' } }
      );

      const [, init] = mockFetch.mock.calls[0]!;
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['A2A-Version']).toBe('0.3');
      expect(headers['X-Custom']).toBe('yes');
      // Content-Type / Accept are set last and should win.
      expect(headers['Content-Type']).toBe('application/json');
    });
  });
});

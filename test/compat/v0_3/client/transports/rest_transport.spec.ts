import { describe, it, beforeEach, expect, vi, type Mock } from 'vitest';

import { LegacyRestTransport } from '../../../../../src/compat/v0_3/client/transports/rest_transport.js';
import {
  A2A_ERROR_CODE,
  PushNotificationNotSupportedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from '../../../../../src/errors.js';
import { formatSSEEvent, formatSSEErrorEvent } from '../../../../../src/sse_utils.js';
import {
  Role,
  TaskState,
  type CancelTaskRequest as V1CancelTaskRequest,
  type DeleteTaskPushNotificationConfigRequest as V1DeleteTaskPushNotificationConfigRequest,
  type GetTaskPushNotificationConfigRequest as V1GetTaskPushNotificationConfigRequest,
  type GetTaskRequest as V1GetTaskRequest,
  type ListTaskPushNotificationConfigsRequest as V1ListTaskPushNotificationConfigsRequest,
  type SendMessageRequest as V1SendMessageRequest,
  type SubscribeToTaskRequest as V1SubscribeToTaskRequest,
  type TaskPushNotificationConfig as V1TaskPushNotificationConfig,
} from '../../../../../src/types/pb/a2a.js';

const ENDPOINT = 'https://test.example/api';

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeNoContentResponse(): Response {
  return new Response(null, { status: 204 });
}

function makeSseResponse(events: object[]): Response {
  const body = events.map((event) => formatSSEEvent(event)).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function makeSseErrorResponse(errorBodies: object[]): Response {
  const body = errorBodies.map((err) => formatSSEErrorEvent(err)).join('');
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

describe('LegacyRestTransport', () => {
  let transport: LegacyRestTransport;
  let mockFetch: Mock<typeof fetch>;

  beforeEach(() => {
    mockFetch = vi.fn();
    transport = new LegacyRestTransport({
      endpoint: ENDPOINT,
      fetchImpl: mockFetch,
    });
  });

  describe('metadata', () => {
    it("protocolName is 'HTTP+JSON'", () => {
      expect(transport.protocolName).toBe('HTTP+JSON');
    });

    it("protocolVersion is '0.3'", () => {
      expect(transport.protocolVersion).toBe('0.3');
    });
  });

  describe('constructor', () => {
    it('trims a trailing slash from endpoint', async () => {
      const t = new LegacyRestTransport({
        endpoint: 'https://test.example/api/',
        fetchImpl: mockFetch,
      });
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-1',
          status: { state: 'working' },
        })
      );

      await t.sendMessage(sendMessageRequest());

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://test.example/api/v1/message:send');
    });

    it('trims multiple trailing slashes from endpoint', async () => {
      const t = new LegacyRestTransport({
        endpoint: 'https://test.example/api///',
        fetchImpl: mockFetch,
      });
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-1',
          status: { state: 'working' },
        })
      );

      await t.sendMessage(sendMessageRequest());

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://test.example/api/v1/message:send');
    });
  });

  describe('getExtendedAgentCard', () => {
    it('emits GET /v1/card and translates the v0.3 AgentCard to v1 proto', async () => {
      const legacyCard: Record<string, unknown> = {
        name: 'My Agent',
        description: 'desc',
        version: '1.2.3',
        url: 'https://agent.example/rest',
        preferredTransport: 'HTTP+JSON',
        protocolVersion: '0.3',
        capabilities: {},
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [],
      };
      mockFetch.mockResolvedValue(makeJsonResponse(legacyCard));

      const card = await transport.getExtendedAgentCard({ tenant: '' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/card`);
      const init2 = init as RequestInit;
      expect(init2.method).toBe('GET');
      const headers = init2.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');

      expect(card.name).toBe('My Agent');
      // Primary interface lifted from card-level (url, preferredTransport,
      // protocolVersion) per the v0.3 → v1.0 translator.
      expect(card.supportedInterfaces[0]!.url).toBe('https://agent.example/rest');
      expect(card.supportedInterfaces[0]!.protocolBinding).toBe('HTTP+JSON');
      expect(card.supportedInterfaces[0]!.protocolVersion).toBe('0.3');
    });
  });

  describe('sendMessage', () => {
    it('emits POST /v1/message:send with v0.3 MessageSendParams body', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-1',
          status: { state: 'working' },
        })
      );

      const result = await transport.sendMessage(sendMessageRequest());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/message:send`);
      const init2 = init as RequestInit;
      expect(init2.method).toBe('POST');
      const headers = init2.headers as Record<string, string>;
      // v0.3 uses bare application/json, not application/a2a+json.
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');

      const body = JSON.parse(init2.body as string);
      // REST body is bare params (no JSON-RPC envelope).
      expect(body.jsonrpc).toBeUndefined();
      expect(body.method).toBeUndefined();
      expect(body.message.kind).toBe('message');
      expect(body.message.role).toBe('user');

      // task result has no messageId; should be translated to v1 Task.
      expect('messageId' in result).toBe(false);
      expect('id' in result && (result as { id: string }).id).toBe('t-1');
    });

    it('translates a v0.3 message-shaped result into a v1 Message', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          kind: 'message',
          messageId: 'msg-resp',
          role: 'agent',
          parts: [],
        })
      );

      const result = await transport.sendMessage(sendMessageRequest());
      expect('messageId' in result && (result as { messageId: string }).messageId).toBe('msg-resp');
    });
  });

  describe('getTask', () => {
    it('emits GET /v1/tasks/:id and translates the v0.3 Task to v1 proto', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-1',
          status: { state: 'completed' },
        })
      );

      const req: V1GetTaskRequest = { tenant: '', id: 't-1', historyLength: 5 };
      const task = await transport.getTask(req);

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/tasks/t-1?historyLength=5`);
      expect((init as RequestInit).method).toBe('GET');
      expect(task.id).toBe('t-1');
      expect(task.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    });

    it('omits the historyLength query parameter when undefined', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-1',
          status: { state: 'working' },
        })
      );

      const req: V1GetTaskRequest = { tenant: '', id: 't-1', historyLength: undefined };
      await transport.getTask(req);

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/tasks/t-1`);
    });

    it('percent-encodes the task id in the URL', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          kind: 'task',
          id: 'a b/c',
          contextId: 'ctx-1',
          status: { state: 'working' },
        })
      );

      await transport.getTask({ tenant: '', id: 'a b/c', historyLength: 0 });

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/tasks/${encodeURIComponent('a b/c')}?historyLength=0`);
    });
  });

  describe('cancelTask', () => {
    it('emits POST /v1/tasks/:id:cancel with no body and translates the v0.3 Task', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-1',
          status: { state: 'canceled' },
        })
      );

      const req: V1CancelTaskRequest = { tenant: '', id: 't-1', metadata: undefined };
      const task = await transport.cancelTask(req);

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/tasks/t-1:cancel`);
      const init2 = init as RequestInit;
      expect(init2.method).toBe('POST');
      expect(init2.body).toBeUndefined();
      expect(task.id).toBe('t-1');
      expect(task.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    });

    it('maps -32002 TASK_NOT_CANCELABLE to TaskNotCancelableError', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse(
          { code: A2A_ERROR_CODE.TASK_NOT_CANCELABLE, message: 'cannot cancel' },
          409
        )
      );

      await expect(
        transport.cancelTask({ tenant: '', id: 't-1', metadata: undefined })
      ).rejects.toBeInstanceOf(TaskNotCancelableError);
    });
  });

  describe('listTasks', () => {
    it('throws UnsupportedOperationError synchronously without calling fetch', async () => {
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
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('error message references the missing v0.3 capability', async () => {
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
        expect(err).toBeInstanceOf(UnsupportedOperationError);
        expect((err as Error).message).toContain('tasks/list');
        expect((err as Error).message).toContain('v0.3');
        return true;
      });
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

    it('createTaskPushNotificationConfig POSTs to the v0.3 path with a v0.3 body', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          taskId: 'task-1',
          pushNotificationConfig: {
            id: 'cfg-1',
            url: 'https://webhook.example/notify',
            token: 'tok',
          },
        })
      );

      const result = await transport.createTaskPushNotificationConfig(v1PushConfig());

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/tasks/task-1/pushNotificationConfigs`);
      const init2 = init as RequestInit;
      expect(init2.method).toBe('POST');
      const body = JSON.parse(init2.body as string);
      expect(body).toEqual({
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

    it('createTaskPushNotificationConfig maps -32003 to PushNotificationNotSupportedError', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse(
          { code: A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED, message: 'no push' },
          400
        )
      );

      await expect(
        transport.createTaskPushNotificationConfig(v1PushConfig())
      ).rejects.toBeInstanceOf(PushNotificationNotSupportedError);
    });

    it('getTaskPushNotificationConfig GETs the v0.3 nested path', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          taskId: 'task-1',
          pushNotificationConfig: {
            id: 'cfg-1',
            url: 'https://webhook.example/notify',
            token: 'tok',
          },
        })
      );

      const req: V1GetTaskPushNotificationConfigRequest = {
        tenant: '',
        taskId: 'task-1',
        id: 'cfg-1',
      };
      const result = await transport.getTaskPushNotificationConfig(req);

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/tasks/task-1/pushNotificationConfigs/cfg-1`);
      expect((init as RequestInit).method).toBe('GET');
      expect(result.id).toBe('cfg-1');
    });

    it('listTaskPushNotificationConfig GETs the collection and wraps the array response', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse([
          {
            taskId: 'task-1',
            pushNotificationConfig: {
              id: 'cfg-1',
              url: 'https://webhook.example/notify',
              token: 'tok',
            },
          },
        ])
      );

      const req: V1ListTaskPushNotificationConfigsRequest = {
        tenant: '',
        taskId: 'task-1',
        pageSize: 0,
        pageToken: '',
      };
      const result = await transport.listTaskPushNotificationConfig(req);

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/tasks/task-1/pushNotificationConfigs`);
      expect(result.configs).toHaveLength(1);
      expect(result.configs[0]!.id).toBe('cfg-1');
    });

    it('deleteTaskPushNotificationConfig DELETEs the nested path and accepts 204', async () => {
      mockFetch.mockResolvedValue(makeNoContentResponse());

      const req: V1DeleteTaskPushNotificationConfigRequest = {
        tenant: '',
        taskId: 'task-1',
        id: 'cfg-1',
      };
      await transport.deleteTaskPushNotificationConfig(req);

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/tasks/task-1/pushNotificationConfigs/cfg-1`);
      const init2 = init as RequestInit;
      expect(init2.method).toBe('DELETE');
      // DELETE never carries a body.
      expect(init2.body).toBeUndefined();
    });
  });

  describe('error envelope mapping', () => {
    it('maps -32001 TASK_NOT_FOUND from a bare v0.3 error body to TaskNotFoundError', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({ code: A2A_ERROR_CODE.TASK_NOT_FOUND, message: 'no such task' }, 404)
      );

      await expect(
        transport.getTask({ tenant: '', id: 't-x', historyLength: 0 })
      ).rejects.toBeInstanceOf(TaskNotFoundError);
    });

    it('falls back to a generic Error for unknown codes', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ code: -42000, message: 'mystery' }, 400));

      await expect(
        transport.getTask({ tenant: '', id: 't-x', historyLength: 0 })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(TaskNotFoundError);
        expect((err as Error).message).toContain('mystery');
        expect((err as Error).message).toContain('-42000');
        return true;
      });
    });

    it('falls back to a generic Error for non-JSON HTTP error bodies', async () => {
      mockFetch.mockResolvedValue(
        new Response('upstream went boom', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      await expect(
        transport.getTask({ tenant: '', id: 't-x', historyLength: 0 })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('500');
        expect((err as Error).message).toContain('upstream went boom');
        return true;
      });
    });
  });

  describe('streaming', () => {
    it('sendMessageStream POSTs to /v1/message:stream and translates bare v0.3 SSE events', async () => {
      const events: Record<string, unknown>[] = [
        {
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-1',
          status: { state: 'submitted' },
        },
        {
          kind: 'status-update',
          taskId: 't-1',
          contextId: 'ctx-1',
          final: false,
          status: { state: 'working' },
        },
        {
          kind: 'artifact-update',
          taskId: 't-1',
          contextId: 'ctx-1',
          artifact: { artifactId: 'a-1', parts: [] },
        },
        {
          kind: 'message',
          messageId: 'm-1',
          role: 'agent',
          parts: [],
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

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/message:stream`);
      const init2 = init as RequestInit;
      const headers = init2.headers as Record<string, string>;
      expect(headers['Accept']).toBe('text/event-stream');

      // Body shape: bare v0.3 params (no JSON-RPC envelope).
      const body = JSON.parse(init2.body as string);
      expect(body.jsonrpc).toBeUndefined();
      expect(body.message.kind).toBe('message');
    });

    it('resubscribeTask POSTs to /v1/tasks/:id:subscribe with no body', async () => {
      mockFetch.mockResolvedValue(makeSseResponse([]));

      const req: V1SubscribeToTaskRequest = { tenant: '', id: 't-1' };
      const events = [];
      for await (const event of transport.resubscribeTask(req)) {
        events.push(event);
      }
      expect(events).toHaveLength(0);

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/v1/tasks/t-1:subscribe`);
      const init2 = init as RequestInit;
      expect(init2.method).toBe('POST');
      expect(init2.body).toBeUndefined();
    });

    it('maps SSE error events with a v0.3 body to typed SDK errors', async () => {
      mockFetch.mockResolvedValue(
        makeSseErrorResponse([
          { code: A2A_ERROR_CODE.TASK_NOT_FOUND, message: 'task gone mid-stream' },
        ])
      );

      const iterator = transport.sendMessageStream(sendMessageRequest());
      await expect(iterator.next()).rejects.toBeInstanceOf(TaskNotFoundError);
    });
  });

  describe('service parameters / headers', () => {
    it('forwards serviceParameters headers to fetch', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-1',
          status: { state: 'working' },
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
      // Content-Type / Accept are appended after the service parameter spread
      // and should win.
      expect(headers['Content-Type']).toBe('application/json');
    });
  });
});

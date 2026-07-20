import { describe, it, beforeEach, afterEach, expect, vi, type Mock, assert } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { legacyGrpcService } from '../../../../../src/compat/v0_3/server/grpc/grpc_service.js';
import {
  PushNotificationNotSupportedError,
  TaskNotCancelableError,
  TaskNotFoundError,
} from '../../../../../src/errors/index.js';
import { A2AError as LegacyA2AError } from '../../../../../src/compat/v0_3/server/error.js';
import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER } from '../../../../../src/constants.js';
import type { A2ARequestHandler } from '../../../../../src/server/request_handler/a2a_request_handler.js';
import {
  Role as V1Role,
  TaskState as V1TaskState,
  type AgentCard as V1AgentCard,
  type Task as V1Task,
} from '../../../../../src/types/pb/a2a.js';
import { decodeErrorInfo, decodeStatus } from '../../../../../src/errors/grpc/index.js';

// v0.3 GRPC interface so validateVersion accepts the defaulted '0.3'.
const testAgentCard: V1AgentCard = {
  name: 'Test Agent',
  description: 'desc',
  version: '1.0.0',
  supportedInterfaces: [
    {
      url: 'http://localhost:50051',
      protocolBinding: 'GRPC',
      tenant: '',
      protocolVersion: '0.3',
    },
  ],
  capabilities: { streaming: true, pushNotifications: true, extensions: [] },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
  provider: undefined,
  documentationUrl: '',
  securitySchemes: {},
  securityRequirements: [],
  signatures: [],
};

function v1Task(id = 'task-1', state = V1TaskState.TASK_STATE_COMPLETED): V1Task {
  return {
    id,
    contextId: 'ctx-1',
    status: { state, timestamp: '', message: undefined },
    artifacts: [],
    history: [],
    metadata: undefined,
  };
}

// ---------------------------------------------------------------------------
// Mock-call helpers
// ---------------------------------------------------------------------------

// We bypass the strict per-RPC `ServerUnaryCall<TReq, TRes>` typings here
// to keep the test fixtures concise: every gRPC handler exercise wants the
// same minimal shape (request + metadata + sendMetadata stub), and the
// real type parameters only matter to the production code.
function createMockUnaryCall(
  request: unknown,
  metadataValues: Record<string, string> = {}
): grpc.ServerUnaryCall<any, any> {
  const metadata = new grpc.Metadata();
  // Default: declare v0.3 so `validateVersion` is happy.
  if (
    !Object.keys(metadataValues).some((k) => k.toLowerCase() === A2A_VERSION_HEADER.toLowerCase())
  ) {
    metadata.set(A2A_VERSION_HEADER.toLowerCase(), '0.3');
  }
  Object.entries(metadataValues).forEach(([k, v]) => metadata.set(k, v));
  return {
    request,
    metadata,
    sendMetadata: vi.fn(),
  } as unknown as grpc.ServerUnaryCall<any, any>;
}

function createMockWritableStream(request: unknown): grpc.ServerWritableStream<any, any> {
  const metadata = new grpc.Metadata();
  metadata.set(A2A_VERSION_HEADER.toLowerCase(), '0.3');
  return {
    request,
    metadata,
    sendMetadata: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    emit: vi.fn(),
  } as unknown as grpc.ServerWritableStream<any, any>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('legacyGrpcService', () => {
  let mockRequestHandler: A2ARequestHandler;
  let handler: ReturnType<typeof legacyGrpcService>;

  beforeEach(() => {
    mockRequestHandler = {
      getAgentCard: vi.fn().mockResolvedValue(testAgentCard),
      getAuthenticatedExtendedAgentCard: vi.fn().mockResolvedValue(testAgentCard),
      sendMessage: vi.fn().mockResolvedValue(v1Task()),
      sendMessageStream: vi.fn(),
      getTask: vi.fn(),
      listTasks: vi.fn(),
      cancelTask: vi.fn(),
      createTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfigs: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      resubscribe: vi.fn(),
    } as unknown as A2ARequestHandler;

    handler = legacyGrpcService({
      requestHandler: mockRequestHandler,
      userBuilder: async () => ({ id: 'test-user' }) as any,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAgentCard (v0.3 name for getExtendedAgentCard)', () => {
    it('translates the v1.0 AgentCard back to v0.3 pb', async () => {
      const call = createMockUnaryCall({});
      const callback = vi.fn();

      await handler.getAgentCard(call, callback);

      expect(mockRequestHandler.getAuthenticatedExtendedAgentCard).toHaveBeenCalled();
      const [err, response] = callback.mock.calls[0];
      assert.isNull(err);
      // v0.3 pb AgentCard surfaces `url` at the top level (folded from
      // `supportedInterfaces[0]`).
      expect(response.name).toBe('Test Agent');
      expect(response.url).toBe('http://localhost:50051');
      expect(response.protocolVersion).toBe('0.3');
      expect(call.sendMetadata).toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('parses a v0.3 pb SendMessageRequest and emits a v0.3 pb SendMessageResponse', async () => {
      const call = createMockUnaryCall({
        request: {
          messageId: 'm1',
          role: V1Role.ROLE_USER /* same enum values as v0.3 pb */,
          content: [],
        },
        configuration: undefined,
        metadata: undefined,
      });
      const callback = vi.fn();

      await handler.sendMessage(call, callback);

      const [err, response] = callback.mock.calls[0];
      assert.isNull(err);
      expect(response.payload.$case).toBe('task');
      expect(response.payload.value.id).toBe('task-1');

      // The request handler should have been called with a v1.0 proto request.
      const [v1Req] = (mockRequestHandler.sendMessage as Mock).mock.calls[0];
      expect(v1Req.message.messageId).toBe('m1');
    });

    it('maps a thrown TaskNotFoundError to NOT_FOUND with ErrorInfo metadata', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        new TaskNotFoundError('Task missing')
      );
      const call = createMockUnaryCall({
        request: { messageId: 'm1', role: V1Role.ROLE_USER, content: [] },
      });
      const callback = vi.fn();

      await handler.sendMessage(call, callback);

      const [err] = callback.mock.calls[0];
      expect(err.code).toBe(grpc.status.NOT_FOUND);
      expect(err.details).toBe('Task missing');

      // grpc-status-details-bin should carry an ErrorInfo with reason TASK_NOT_FOUND.
      const bin = (err.metadata as grpc.Metadata).get('grpc-status-details-bin');
      expect(bin.length).toBeGreaterThan(0);
      const status = decodeStatus(bin[0] as Buffer);
      expect(status.details.length).toBeGreaterThan(0);
      const errorInfo = decodeErrorInfo(status.details[0]!.value as unknown as Buffer);
      expect(errorInfo.reason).toBe('TASK_NOT_FOUND');
    });

    it('maps a thrown LegacyA2AError.invalidParams (-32602) to INVALID_ARGUMENT', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        LegacyA2AError.invalidParams('Invalid role: 0')
      );
      const call = createMockUnaryCall({
        request: { messageId: 'm1', role: V1Role.ROLE_USER, content: [] },
      });
      const callback = vi.fn();

      await handler.sendMessage(call, callback);

      const [err] = callback.mock.calls[0];
      expect(err.code).toBe(grpc.status.INVALID_ARGUMENT);
      expect(err.details).toBe('Invalid role: 0');
    });

    it('maps LegacyA2AError.taskNotFound (-32001) to NOT_FOUND', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        LegacyA2AError.taskNotFound('t-1')
      );
      const call = createMockUnaryCall({
        request: { messageId: 'm1', role: V1Role.ROLE_USER, content: [] },
      });
      const callback = vi.fn();

      await handler.sendMessage(call, callback);

      expect(callback.mock.calls[0][0].code).toBe(grpc.status.NOT_FOUND);
    });

    it('maps LegacyA2AError.methodNotFound (-32601) to UNIMPLEMENTED', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        LegacyA2AError.methodNotFound('whatever')
      );
      const call = createMockUnaryCall({
        request: { messageId: 'm1', role: V1Role.ROLE_USER, content: [] },
      });
      const callback = vi.fn();

      await handler.sendMessage(call, callback);

      expect(callback.mock.calls[0][0].code).toBe(grpc.status.UNIMPLEMENTED);
    });

    it('maps LegacyA2AError.internalError (-32603) to INTERNAL', async () => {
      (mockRequestHandler.sendMessage as Mock).mockRejectedValue(
        LegacyA2AError.internalError('boom')
      );
      const call = createMockUnaryCall({
        request: { messageId: 'm1', role: V1Role.ROLE_USER, content: [] },
      });
      const callback = vi.fn();

      await handler.sendMessage(call, callback);

      expect(callback.mock.calls[0][0].code).toBe(grpc.status.INTERNAL);
    });
  });

  describe('sendStreamingMessage', () => {
    it('streams v0.3 pb StreamResponses for each v1.0 stream event', async () => {
      const v1Message: Record<string, unknown> = {
        messageId: 'm1',
        contextId: '',
        taskId: '',
        role: V1Role.ROLE_AGENT,
        parts: [],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      };
      async function* mockStream() {
        yield { payload: { $case: 'message' as const, value: v1Message } };
        yield { payload: { $case: 'task' as const, value: v1Task() } };
      }
      (mockRequestHandler.sendMessageStream as Mock).mockReturnValue(mockStream());

      const call = createMockWritableStream({
        request: { messageId: 'm1', role: V1Role.ROLE_USER, content: [] },
      });

      await handler.sendStreamingMessage(call);

      expect(call.write).toHaveBeenCalledTimes(2);
      expect(call.end).toHaveBeenCalled();
      expect(call.sendMetadata).toHaveBeenCalled();

      // v0.3 pb uses `msg` (not `message`) for the SendMessageResponse oneof
      // case discriminator.
      const firstEvent = (call.write as Mock).mock.calls[0]![0];
      expect(['msg', 'message']).toContain(firstEvent.payload.$case);
    });

    it('emits an error on stream failure with the mapped gRPC status', async () => {
      (mockRequestHandler.sendMessageStream as Mock).mockImplementation(async function* () {
        throw new TaskNotFoundError('stream crash');
        yield {};
      });

      const call = createMockWritableStream({
        request: { messageId: 'm1', role: V1Role.ROLE_USER, content: [] },
      });

      await handler.sendStreamingMessage(call);

      expect(call.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: grpc.status.NOT_FOUND,
        })
      );
      expect(call.end).toHaveBeenCalled();
    });
  });

  describe('getTask', () => {
    it('parses tasks/{id} and translates the response', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(v1Task('t-1'));
      const call = createMockUnaryCall({ name: 'tasks/t-1', historyLength: 0 });
      const callback = vi.fn();

      await handler.getTask(call, callback);

      const [err, response] = callback.mock.calls[0];
      assert.isNull(err);
      expect(response.id).toBe('t-1');

      const [v1Req] = (mockRequestHandler.getTask as Mock).mock.calls[0];
      expect(v1Req.id).toBe('t-1');
    });
  });

  describe('cancelTask', () => {
    it('parses tasks/{id} and maps TaskNotCancelableError to FAILED_PRECONDITION', async () => {
      (mockRequestHandler.cancelTask as Mock).mockRejectedValue(new TaskNotCancelableError('nope'));
      const call = createMockUnaryCall({ name: 'tasks/t-1' });
      const callback = vi.fn();

      await handler.cancelTask(call, callback);

      const [err] = callback.mock.calls[0];
      expect(err.code).toBe(grpc.status.FAILED_PRECONDITION);
      expect(err.details).toBe('nope');
    });
  });

  describe('taskSubscription (v0.3 name for subscribeToTask)', () => {
    it('parses tasks/{id} and yields the v0.3 stream', async () => {
      async function* mockStream() {
        yield { payload: { $case: 'task' as const, value: v1Task('t-1') } };
      }
      (mockRequestHandler.resubscribe as Mock).mockReturnValue(mockStream());

      const call = createMockWritableStream({ name: 'tasks/t-1' });
      await handler.taskSubscription(call);

      expect(call.write).toHaveBeenCalledTimes(1);
      expect(call.end).toHaveBeenCalled();
      const [v1Req] = (mockRequestHandler.resubscribe as Mock).mock.calls[0];
      expect(v1Req.id).toBe('t-1');
    });
  });

  describe('push notification configs', () => {
    const v0pbConfig: Record<string, unknown> = {
      name: 'tasks/task-1/pushNotificationConfigs/cfg-1',
      pushNotificationConfig: {
        id: 'cfg-1',
        url: 'http://example/notify',
        token: 'tok',
        authentication: undefined,
      },
    };

    it('createTaskPushNotificationConfig unwraps the Create request', async () => {
      (mockRequestHandler.createTaskPushNotificationConfig as Mock).mockResolvedValue({
        tenant: '',
        taskId: 'task-1',
        id: 'cfg-1',
        url: 'http://example/notify',
        token: 'tok',
        authentication: undefined,
      });

      const call = createMockUnaryCall({
        parent: 'tasks/task-1',
        configId: 'cfg-1',
        config: v0pbConfig,
      });
      const callback = vi.fn();

      await handler.createTaskPushNotificationConfig(call, callback);

      const [err, response] = callback.mock.calls[0];
      assert.isNull(err);
      expect(response.name).toBe('tasks/task-1/pushNotificationConfigs/cfg-1');
    });

    it('getTaskPushNotificationConfig parses the URI name', async () => {
      (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockResolvedValue({
        tenant: '',
        taskId: 'task-1',
        id: 'cfg-1',
        url: 'http://example/notify',
        token: 'tok',
        authentication: undefined,
      });

      const call = createMockUnaryCall({
        name: 'tasks/task-1/pushNotificationConfigs/cfg-1',
      });
      const callback = vi.fn();

      await handler.getTaskPushNotificationConfig(call, callback);

      const [v1Req] = (mockRequestHandler.getTaskPushNotificationConfig as Mock).mock.calls[0];
      expect(v1Req.taskId).toBe('task-1');
      expect(v1Req.id).toBe('cfg-1');
    });

    it('listTaskPushNotificationConfig (singular) translates the response', async () => {
      (mockRequestHandler.listTaskPushNotificationConfigs as Mock).mockResolvedValue({
        configs: [
          {
            tenant: '',
            taskId: 'task-1',
            id: 'cfg-1',
            url: 'http://example/notify',
            token: 'tok',
            authentication: undefined,
          },
        ],
        nextPageToken: '',
      });

      const call = createMockUnaryCall({ parent: 'tasks/task-1', pageSize: 0, pageToken: '' });
      const callback = vi.fn();

      await handler.listTaskPushNotificationConfig(call, callback);

      const [err, response] = callback.mock.calls[0];
      assert.isNull(err);
      expect(response.configs).toHaveLength(1);
      expect(response.configs[0].pushNotificationConfig?.id).toBe('cfg-1');
    });

    it('deleteTaskPushNotificationConfig parses the URI name and returns Empty', async () => {
      (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockResolvedValue(undefined);

      const call = createMockUnaryCall({
        name: 'tasks/task-1/pushNotificationConfigs/cfg-1',
      });
      const callback = vi.fn();

      await handler.deleteTaskPushNotificationConfig(call, callback);

      const [err, response] = callback.mock.calls[0];
      assert.isNull(err);
      expect(response).toEqual({});

      const [v1Req] = (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mock.calls[0];
      expect(v1Req.taskId).toBe('task-1');
      expect(v1Req.id).toBe('cfg-1');
    });

    it('maps PushNotificationNotSupportedError to FAILED_PRECONDITION', async () => {
      (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockRejectedValue(
        new PushNotificationNotSupportedError('no push')
      );

      const call = createMockUnaryCall({
        name: 'tasks/task-1/pushNotificationConfigs/cfg-1',
      });
      const callback = vi.fn();

      await handler.getTaskPushNotificationConfig(call, callback);

      const [err] = callback.mock.calls[0];
      expect(err.code).toBe(grpc.status.FAILED_PRECONDITION);
    });
  });

  describe('extensions metadata handling', () => {
    it('extracts extensions from gRPC metadata and forwards them to the context', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(v1Task('t-1'));
      const call = createMockUnaryCall(
        { name: 'tasks/t-1', historyLength: 0 },
        {
          [HTTP_EXTENSION_HEADER.toLowerCase()]: 'ext-v1',
        }
      );
      const callback = vi.fn();

      await handler.getTask(call, callback);

      const [, context] = (mockRequestHandler.getTask as Mock).mock.calls[0];
      expect(context.requestedExtensions).toEqual(['ext-v1']);
    });

    it('also accepts the v0.3-style X-A2A-Extensions header', async () => {
      (mockRequestHandler.getTask as Mock).mockResolvedValue(v1Task('t-1'));
      const call = createMockUnaryCall(
        { name: 'tasks/t-1', historyLength: 0 },
        { 'x-a2a-extensions': 'legacy-ext-v1' }
      );
      const callback = vi.fn();

      await handler.getTask(call, callback);

      const [, context] = (mockRequestHandler.getTask as Mock).mock.calls[0];
      expect(context.requestedExtensions).toEqual(['legacy-ext-v1']);
    });
  });

  describe('version validation', () => {
    it('rejects requests for a v1.0 version when the agent only declares v0.3 gRPC', async () => {
      const call = createMockUnaryCall(
        { name: 'tasks/t-1', historyLength: 0 },
        { [A2A_VERSION_HEADER.toLowerCase()]: '1.0' }
      );
      const callback = vi.fn();

      await handler.getTask(call, callback);

      const [err] = callback.mock.calls[0];
      // `VersionNotSupportedError` maps to `FAILED_PRECONDITION` per the
      // `instanceof` chain in `mapToError`.
      expect(err.code).toBe(grpc.status.FAILED_PRECONDITION);
    });
  });
});

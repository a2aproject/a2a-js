import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from 'vitest';
import { credentials, Metadata, ServiceError, status } from '@grpc/grpc-js';
import {
  LegacyGrpcTransport,
  type LegacyGrpcTransportOptions,
} from '../../../../../../src/compat/v0_3/client/transports/grpc/grpc_transport.js';
import { A2AServiceClient } from '../../../../../../src/compat/v0_3/grpc/pb/a2a.js';
import { TaskNotFoundError, UnsupportedOperationError } from '../../../../../../src/errors.js';
import { buildGrpcErrorMetadata } from '../../../../../../src/server/grpc/error_details.js';
import {
  Role as V1Role,
  TaskState as V1TaskState,
  type SendMessageRequest as V1SendMessageRequest,
  type GetTaskRequest as V1GetTaskRequest,
  type CancelTaskRequest as V1CancelTaskRequest,
  type TaskPushNotificationConfig as V1TaskPushNotificationConfig,
  type GetTaskPushNotificationConfigRequest as V1GetTaskPushNotificationConfigRequest,
  type ListTaskPushNotificationConfigsRequest as V1ListTaskPushNotificationConfigsRequest,
  type DeleteTaskPushNotificationConfigRequest as V1DeleteTaskPushNotificationConfigRequest,
  type SubscribeToTaskRequest as V1SubscribeToTaskRequest,
  type Task as V1Task,
} from '../../../../../../src/types/pb/a2a.js';

// --- Mocks ---

// Mock the v0.3 gRPC client class so we can intercept calls without
// standing up a real server. The set of methods mirrors the v0.3
// `A2AServiceClient` interface declared in `src/compat/v0_3/grpc/pb/a2a.ts`.
vi.mock('../../../../../../src/compat/v0_3/grpc/pb/a2a.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../../../src/compat/v0_3/grpc/pb/a2a.js')>();
  const A2AServiceClient = vi.fn();
  A2AServiceClient.prototype.getAgentCard = vi.fn();
  A2AServiceClient.prototype.sendMessage = vi.fn();
  A2AServiceClient.prototype.sendStreamingMessage = vi.fn();
  A2AServiceClient.prototype.createTaskPushNotificationConfig = vi.fn();
  A2AServiceClient.prototype.getTaskPushNotificationConfig = vi.fn();
  A2AServiceClient.prototype.listTaskPushNotificationConfig = vi.fn();
  A2AServiceClient.prototype.deleteTaskPushNotificationConfig = vi.fn();
  A2AServiceClient.prototype.getTask = vi.fn();
  A2AServiceClient.prototype.cancelTask = vi.fn();
  A2AServiceClient.prototype.taskSubscription = vi.fn();
  return { ...actual, A2AServiceClient };
});

const ENDPOINT = 'localhost:50051';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function v1SendMessageRequest(): V1SendMessageRequest {
  return {
    tenant: '',
    message: {
      messageId: 'msg-1',
      contextId: '',
      taskId: '',
      role: V1Role.ROLE_USER,
      parts: [
        {
          content: { $case: 'text', value: 'hello' },
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

/**
 * A minimal v0.3 pb Task response. Field names use v0.3 pb camelCase
 * conventions (`contextId`, `status.state` as an enum value).
 */
function v03PbTask(id = 't-1', state = 3 /* TASK_STATE_COMPLETED */): unknown {
  return {
    id,
    contextId: 'ctx-1',
    status: { state, timestamp: '2024-01-01T00:00:00.000Z', update: undefined },
    artifacts: [],
    history: [],
    metadata: undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUnarySuccess = (method: Mock, response: unknown) => {
  method.mockImplementation((_req: unknown, _meta: unknown, _opts: unknown, callback: any) => {
    callback(null, response);
    return {};
  });
};

const mockUnaryError = (method: Mock, code: number, message: string, sdkError?: Error) => {
  method.mockImplementation((_req: unknown, _meta: unknown, _opts: unknown, callback: any) => {
    const metadata = sdkError ? buildGrpcErrorMetadata(code, message, sdkError) : undefined;
    const error: Partial<ServiceError> = {
      code,
      details: message,
      metadata: metadata ?? new Metadata(),
    };
    callback(error, null);
    return {};
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LegacyGrpcTransport', () => {
  let transport: LegacyGrpcTransport;
  let mockGrpcClient: A2AServiceClient;

  beforeEach(() => {
    mockGrpcClient = new A2AServiceClient(ENDPOINT, credentials.createInsecure());
    transport = new LegacyGrpcTransport({ endpoint: ENDPOINT } as LegacyGrpcTransportOptions);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('metadata', () => {
    it("protocolName is 'GRPC'", () => {
      expect(transport.protocolName).toBe('GRPC');
    });

    it("protocolVersion is '0.3'", () => {
      expect(transport.protocolVersion).toBe('0.3');
    });
  });

  describe('getExtendedAgentCard', () => {
    it('calls the v0.3 `getAgentCard` RPC and translates the response', async () => {
      const pbCard: Record<string, unknown> = {
        protocolVersion: '0.3.0',
        name: 'Agent',
        description: 'desc',
        url: 'http://example',
        preferredTransport: 'GRPC',
        additionalInterfaces: [],
        provider: undefined,
        version: '1.0',
        documentationUrl: '',
        capabilities: { streaming: true, pushNotifications: false, extensions: [] },
        securitySchemes: {},
        security: [],
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [],
        supportsAuthenticatedExtendedCard: false,
        signatures: [],
      };
      mockUnarySuccess(mockGrpcClient.getAgentCard as Mock, pbCard);

      const result = await transport.getExtendedAgentCard({ tenant: '' });

      expect(mockGrpcClient.getAgentCard).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('Agent');
      // v1.0 AgentCard exposes the endpoint via `supportedInterfaces[*].url`
      // (the v0.3 card-level `url` is folded into the primary interface).
      expect(result.supportedInterfaces?.[0]?.url).toBe('http://example');
    });
  });

  describe('sendMessage', () => {
    it('translates a v0.3 Task response to a v1.0 proto Task', async () => {
      mockUnarySuccess(mockGrpcClient.sendMessage as Mock, {
        payload: { $case: 'task', value: v03PbTask('t-1', 3) },
      });

      const result = await transport.sendMessage(v1SendMessageRequest());

      // v1.0 proto Task uses `id` and `status.state` enum values.
      expect((result as V1Task).id).toBe('t-1');
      expect((result as V1Task).status?.state).toBe(V1TaskState.TASK_STATE_COMPLETED);
      expect(mockGrpcClient.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('translates a v0.3 Message response to a v1.0 proto Message', async () => {
      mockUnarySuccess(mockGrpcClient.sendMessage as Mock, {
        payload: {
          $case: 'msg',
          value: {
            messageId: 'msg-resp',
            contextId: '',
            taskId: '',
            role: 2 /* ROLE_AGENT */,
            content: [],
            metadata: undefined,
            extensions: [],
          },
        },
      });

      const result = await transport.sendMessage(v1SendMessageRequest());
      expect('messageId' in result && (result as { messageId: string }).messageId).toBe('msg-resp');
    });

    it('passes service parameters as gRPC metadata', async () => {
      mockUnarySuccess(mockGrpcClient.sendMessage as Mock, {
        payload: { $case: 'task', value: v03PbTask() },
      });

      await transport.sendMessage(v1SendMessageRequest(), {
        serviceParameters: { 'x-test-header': 'test-value' },
      });

      const calledMetadata = (mockGrpcClient.sendMessage as Mock).mock.calls[0]![1] as Metadata;
      expect(calledMetadata.get('x-test-header')).toEqual(['test-value']);
    });

    it('maps a TASK_NOT_FOUND error from ErrorInfo metadata to TaskNotFoundError', async () => {
      mockUnaryError(
        mockGrpcClient.sendMessage as Mock,
        status.NOT_FOUND,
        'Task missing',
        new TaskNotFoundError('Task missing')
      );

      await expect(transport.sendMessage(v1SendMessageRequest())).rejects.toThrow(
        TaskNotFoundError
      );
    });

    it('produces a generic Error for status codes with no SDK mapping', async () => {
      mockUnaryError(mockGrpcClient.sendMessage as Mock, status.UNKNOWN, 'mystery');

      await expect(transport.sendMessage(v1SendMessageRequest())).rejects.toThrow(
        /gRPC error for sendMessage/
      );
    });

    it('cancels the request when the AbortSignal is aborted', async () => {
      const cancelMock = vi.fn();
      (mockGrpcClient.sendMessage as Mock).mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, callback: any) => {
          return {
            cancel: () => {
              cancelMock();
              callback({ code: status.CANCELLED, details: 'Cancelled' }, null);
            },
          };
        }
      );

      const controller = new AbortController();
      const promise = transport.sendMessage(v1SendMessageRequest(), { signal: controller.signal });
      controller.abort();

      expect(cancelMock).toHaveBeenCalled();
      await expect(promise).rejects.toThrow();
    });
  });

  describe('sendMessageStream', () => {
    it('yields v1.0 proto StreamResponse from v0.3 pb stream events', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { payload: { $case: 'task', value: v03PbTask('t-1', 3) } };
        },
        cancel: vi.fn(),
      };
      (mockGrpcClient.sendStreamingMessage as Mock).mockReturnValue(mockStream);

      const iterator = transport.sendMessageStream(v1SendMessageRequest());
      const first = await iterator.next();
      expect(first.done).toBe(false);
      const value = first.value as { payload?: { $case: string } } | undefined;
      expect(value?.payload?.$case).toBe('task');
    });
  });

  describe('getTask', () => {
    it('emits a v0.3 `GetTask` RPC with name=tasks/{id} and translates the response', async () => {
      mockUnarySuccess(mockGrpcClient.getTask as Mock, v03PbTask('t-1', 3));

      const req: V1GetTaskRequest = { tenant: '', id: 't-1', historyLength: 5 };
      const result = await transport.getTask(req);

      const sentReq = (mockGrpcClient.getTask as Mock).mock.calls[0]![0] as {
        name: string;
        historyLength: number;
      };
      expect(sentReq.name).toBe('tasks/t-1');
      expect(sentReq.historyLength).toBe(5);
      expect(result.id).toBe('t-1');
    });

    it('maps NOT_FOUND to TaskNotFoundError', async () => {
      mockUnaryError(
        mockGrpcClient.getTask as Mock,
        status.NOT_FOUND,
        'not found',
        new TaskNotFoundError('not found')
      );

      await expect(transport.getTask({ tenant: '', id: 'bad', historyLength: 0 })).rejects.toThrow(
        TaskNotFoundError
      );
    });
  });

  describe('cancelTask', () => {
    it('emits a v0.3 `CancelTask` RPC with name=tasks/{id}', async () => {
      mockUnarySuccess(
        mockGrpcClient.cancelTask as Mock,
        v03PbTask('t-1', 5 /* TASK_STATE_CANCELLED */)
      );

      const req: V1CancelTaskRequest = { tenant: '', id: 't-1', metadata: undefined };
      const result = await transport.cancelTask(req);

      const sentReq = (mockGrpcClient.cancelTask as Mock).mock.calls[0]![0] as { name: string };
      expect(sentReq.name).toBe('tasks/t-1');
      expect(result.id).toBe('t-1');
    });
  });

  describe('push notification configs', () => {
    const v1Config: V1TaskPushNotificationConfig = {
      tenant: '',
      taskId: 'task-1',
      id: 'cfg-1',
      url: 'https://example/notify',
      token: 'tok',
      authentication: undefined,
    };

    const v03PbConfig: Record<string, unknown> = {
      name: 'tasks/task-1/pushNotificationConfigs/cfg-1',
      pushNotificationConfig: {
        id: 'cfg-1',
        url: 'https://example/notify',
        token: 'tok',
        authentication: undefined,
      },
    };

    it('createTaskPushNotificationConfig wraps the config in a v0.3 Create request', async () => {
      mockUnarySuccess(mockGrpcClient.createTaskPushNotificationConfig as Mock, v03PbConfig);

      await transport.createTaskPushNotificationConfig(v1Config);

      const sentReq = (mockGrpcClient.createTaskPushNotificationConfig as Mock).mock
        .calls[0]![0] as { parent: string; configId: string; config: unknown };
      expect(sentReq.parent).toBe('tasks/task-1');
      expect(sentReq.configId).toBe('cfg-1');
      expect(sentReq.config).toBeDefined();
    });

    it('getTaskPushNotificationConfig builds the v0.3 resource name', async () => {
      mockUnarySuccess(mockGrpcClient.getTaskPushNotificationConfig as Mock, v03PbConfig);

      const req: V1GetTaskPushNotificationConfigRequest = {
        tenant: '',
        taskId: 'task-1',
        id: 'cfg-1',
      };
      await transport.getTaskPushNotificationConfig(req);

      const sentReq = (mockGrpcClient.getTaskPushNotificationConfig as Mock).mock.calls[0]![0] as {
        name: string;
      };
      expect(sentReq.name).toBe('tasks/task-1/pushNotificationConfigs/cfg-1');
    });

    it('listTaskPushNotificationConfig uses the singular v0.3 RPC and wraps into v1.0 List response', async () => {
      mockUnarySuccess(mockGrpcClient.listTaskPushNotificationConfig as Mock, {
        configs: [v03PbConfig],
        nextPageToken: '',
      });

      const req: V1ListTaskPushNotificationConfigsRequest = {
        tenant: '',
        taskId: 'task-1',
        pageSize: 0,
        pageToken: '',
      };
      const response = await transport.listTaskPushNotificationConfig(req);

      const sentReq = (mockGrpcClient.listTaskPushNotificationConfig as Mock).mock.calls[0]![0] as {
        parent: string;
      };
      expect(sentReq.parent).toBe('tasks/task-1');
      expect(response.configs).toHaveLength(1);
      expect(response.configs[0]!.taskId).toBe('task-1');
    });

    it('deleteTaskPushNotificationConfig builds the v0.3 resource name', async () => {
      mockUnarySuccess(mockGrpcClient.deleteTaskPushNotificationConfig as Mock, {});

      const req: V1DeleteTaskPushNotificationConfigRequest = {
        tenant: '',
        taskId: 'task-1',
        id: 'cfg-1',
      };
      await transport.deleteTaskPushNotificationConfig(req);

      const sentReq = (mockGrpcClient.deleteTaskPushNotificationConfig as Mock).mock
        .calls[0]![0] as { name: string };
      expect(sentReq.name).toBe('tasks/task-1/pushNotificationConfigs/cfg-1');
    });
  });

  describe('resubscribeTask', () => {
    it('uses the v0.3 `taskSubscription` RPC and translates the stream', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { payload: { $case: 'task', value: v03PbTask('t-1', 3) } };
        },
        cancel: vi.fn(),
      };
      (mockGrpcClient.taskSubscription as Mock).mockReturnValue(mockStream);

      const req: V1SubscribeToTaskRequest = { tenant: '', id: 't-1' };
      const iterator = transport.resubscribeTask(req);
      const first = await iterator.next();
      expect(first.done).toBe(false);
      const value = first.value as { payload?: { $case: string } } | undefined;
      expect(value?.payload?.$case).toBe('task');

      // The RPC argument carries the v0.3 resource name shape.
      const sentReq = (mockGrpcClient.taskSubscription as Mock).mock.calls[0]![0] as {
        name: string;
      };
      expect(sentReq.name).toBe('tasks/t-1');
    });
  });

  describe('listTasks', () => {
    it('throws UnsupportedOperationError synchronously without issuing any RPC', async () => {
      await expect(
        transport.listTasks({
          tenant: '',
          contextId: '',
          pageSize: 0,
          pageToken: '',
          historyLength: 0,
          statusTimestampAfter: '',
          status: 0,
          includeArtifacts: false,
        })
      ).rejects.toThrow(UnsupportedOperationError);

      // None of the gRPC client methods should have been called.
      expect(mockGrpcClient.getAgentCard).not.toHaveBeenCalled();
      expect(mockGrpcClient.sendMessage).not.toHaveBeenCalled();
    });
  });
});

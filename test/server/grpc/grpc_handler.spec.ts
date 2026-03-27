import { describe, it, beforeEach, afterEach, assert, expect, vi, Mock } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import * as proto from '../../../src/grpc/pb/a2a.js';
import { A2ARequestHandler } from '../../../src/server/index.js';
import { TaskNotFoundError } from '../../../src/errors.js';
import { grpcService } from '../../../src/server/grpc/grpc_service.js';
import { AgentCard, HTTP_EXTENSION_HEADER, Task, Role, TaskState } from '../../../src/index.js';

vi.mock('../../../src/types/converters/from_proto.js', () => ({
  FromProto: {
    messageStreamResult: vi.fn((x) => x),
    createTaskPushNotificationConfig: vi.fn((x) => x),
  },
}));

// Mock ToProto which is used in grpc_service.ts
vi.mock('../../../src/types/converters/to_proto.js', () => ({
  ToProto: {
    messageSendResult: vi.fn((result) => {
      // Mock implementation that wraps result like ToProto would
      if ('id' in result) {
        return { payload: { $case: 'task', value: result } };
      }
      return { payload: { $case: 'message', value: result } };
    }),
    messageStreamResult: vi.fn((result) => result), // Pass through for stream
    listTaskPushNotificationConfig: vi.fn((configs) => ({ configs })),
    taskTaskPushNotificationConfig: vi.fn((config) => config),
  },
}));

describe('grpcHandler', () => {
  let mockRequestHandler: A2ARequestHandler;
  let handler: ReturnType<typeof grpcService>;

  const testAgentCard = {    name: 'Test Agent',
    description: 'An agent for testing purposes',
    url: 'http://localhost:8080',    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: true, extensions: [] },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    documentationUrl: 'http://test-agent.com/docs',
    securityRequirements: [],
    securitySchemes: {},
    signatures: [],
    provider: { url: '', organization: '' },
    additionalInterfaces: [],  };

  const testTask: Task = {
    id: 'task-1',
    status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: undefined, message: undefined },
    contextId: 'ctx-1',
    history: [],
    artifacts: [],
    metadata: {}, referenceTaskIds: [],
  };

  // Helper to create a mock gRPC Unary Call
  const createMockUnaryCall = (
    request: any,
    metadataValues: Record<string, string> = {}
  ): grpc.ServerUnaryCall<any, any> => {
    const metadata = new grpc.Metadata();
    Object.entries(metadataValues).forEach(([k, v]) => metadata.set(k, v));
    return {
      request,
      metadata,
      sendMetadata: vi.fn(),
    } as unknown as grpc.ServerUnaryCall<any, any>;
  };

  // Helper to create a mock gRPC Writable Stream
  const createMockWritableStream = (request: any) => {
    return {
      request,
      metadata: new grpc.Metadata(),
      sendMetadata: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      emit: vi.fn(),
    } as unknown as grpc.ServerWritableStream<any, any>;
  };

  beforeEach(() => {
    mockRequestHandler = {
      getAgentCard: vi.fn().mockResolvedValue(testAgentCard),
      getAuthenticatedExtendedAgentCard: vi.fn().mockResolvedValue(testAgentCard),
      sendMessage: vi.fn().mockResolvedValue(testTask),
      sendMessageStream: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      setTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfigs: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      resubscribe: vi.fn(),
    };

    handler = grpcService({
      requestHandler: mockRequestHandler,
      userBuilder: async () => ({ id: 'test-user' }) as any,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getExtendedAgentCard', () => {
    it('should return agent card via gRPC callback', async () => {
      const call = createMockUnaryCall({});
      const callback = vi.fn();
      await handler.getExtendedAgentCard(call, callback);

      expect(mockRequestHandler.getAuthenticatedExtendedAgentCard).toHaveBeenCalled();
      const [err, response] = callback.mock.calls[0];
      assert.isNull(err);
      assert.deepEqual(response, testAgentCard as unknown as proto.AgentCard);
      expect(call.sendMetadata).toHaveBeenCalled();
    });

    it('should return gRPC error code on failure', async () => {
      (mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).mockRejectedValue(
        new TaskNotFoundError('Not Found')
      );
      const call = createMockUnaryCall({});
      const callback = vi.fn();

      await handler.getExtendedAgentCard(call, callback);

      const [err] = callback.mock.calls[0];
      assert.equal(err.code, grpc.status.NOT_FOUND);
      assert.equal(err.details, 'Not Found');
    });
  });

  describe('sendMessage', () => {
    it('should successfully send a message and return a task', async () => {
      // SendMessageRequest has 'message' field
      const call = createMockUnaryCall({ message: { role: Role.ROLE_USER, parts: [] as any } });
      const callback = vi.fn();

      await handler.sendMessage(call, callback);

      const [err, response] = callback.mock.calls[0];
      assert.isNull(err);
      // Our mocked ToProto wraps it in { payload: { $case: 'task', value: ... } }
      assert.equal(response.payload.$case, 'task');
      assert.equal(response.payload.value.id, testTask.id);
    });
  });

  describe('sendStreamingMessage', () => {
    it('should stream multiple parts and end correctly', async () => {
      async function* mockStream() {
        yield { messageId: 'm1', role: Role.ROLE_AGENT, parts: [] as any };
        yield { id: 't1', status: { state: TaskState.TASK_STATE_COMPLETED } };
      }
      (mockRequestHandler.sendMessageStream as Mock).mockResolvedValue(mockStream());

      const call = createMockWritableStream({
        message: { role: Role.ROLE_USER, parts: [] as any },
      });

      await handler.sendStreamingMessage(call);

      expect(call.write).toHaveBeenCalledTimes(2);
      expect(call.end).toHaveBeenCalled();
      expect(call.sendMetadata).toHaveBeenCalled();
    });

    it('should emit error on stream failure', async () => {
      (mockRequestHandler.sendMessageStream as Mock).mockRejectedValue(new Error('Stream crash'));
      const call = createMockWritableStream({});

      await handler.sendStreamingMessage(call);

      expect(call.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: grpc.status.UNKNOWN,
        })
      );
      expect(call.end).toHaveBeenCalled();
    });
  });

  describe('Extensions (Metadata) Handling', () => {
    it('should extract extensions from metadata and pass to context', async () => {
      // Mocking the header 'x-a2a-extension'
      const call = createMockUnaryCall(
        { id: 'task-1' },
        {
          [HTTP_EXTENSION_HEADER.toLowerCase()]: 'extension-v1',
        }
      );
      const callback = vi.fn();

      await handler.getTask(call, callback);

      const contextArg = (mockRequestHandler.getTask as Mock).mock.calls[0][1];
      expect(contextArg).toBeDefined();
      expect(contextArg.requestedExtensions).toEqual(['extension-v1']);
    });

    it('should return activated extensions in context through metadata', async () => {
      // Mocking the header 'x-a2a-extension'
      const call = createMockUnaryCall(
        { id: 'task-1' },
        {
          [HTTP_EXTENSION_HEADER.toLowerCase()]: 'extension-v1',
        }
      );
      const callback = vi.fn();

      (mockRequestHandler.getTask as Mock).mockImplementation(async (_params, context) => {
        context.addActivatedExtension('extension-v1');
        return testTask;
      });

      await handler.getTask(call, callback);

      const [metadata] = (call.sendMetadata as Mock).mock.calls[0];
      expect(metadata).toBeDefined();
      expect(metadata.get(HTTP_EXTENSION_HEADER.toLowerCase())).toEqual(['extension-v1']);
    });
  });
});

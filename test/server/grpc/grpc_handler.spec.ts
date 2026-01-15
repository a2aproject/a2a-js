import { describe, it, beforeEach, afterEach, assert, expect, vi, Mock } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import * as proto from '../../../src/grpc/pb/a2a_services.js';
import { A2AError, A2ARequestHandler } from '../../../src/server/index.js';
import { grpcService } from '../../../src/server/grpc/grpc_handler.js';
import { AgentCard, HTTP_EXTENSION_HEADER, MessageSendParams, Task } from '../../../src/index.js';
import { ToProto } from '../../../src/types/converters/to_proto.js';
import { FromProto } from '../../../src/types/converters/from_proto.js';

vi.mock('../../../src/types/converters/from_proto.js');
vi.mock('../../../src/types/converters/to_proto.js');
describe('grpcHandler', () => {
  let mockRequestHandler: A2ARequestHandler;
  let handler: ReturnType<typeof grpcService>;

  const testAgentCard: AgentCard = {
    protocolVersion: '0.3.0',
    name: 'Test Agent',
    description: 'An agent for testing purposes',
    url: 'http://localhost:8080',
    preferredTransport: 'gRPC',
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
  };

  const testTask: Task = {
    id: 'task-1',
    kind: 'task' as const,
    status: { state: 'completed' as const },
    contextId: 'ctx-1',
    history: [],
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
      getAuthenticatedExtendedAgentCard: vi.fn(),
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

  describe('getAgentCard', () => {
    it('should return agent card via gRPC callback', async () => {
      const call = createMockUnaryCall({});
      const callback = vi.fn();
      const mockProtoAgentCard = { name: 'Proto Test Agent' } as proto.AgentCard;

      (ToProto.agentCard as Mock).mockReturnValue(mockProtoAgentCard);

      await handler.getAgentCard(call, callback);

      expect(mockRequestHandler.getAgentCard).toHaveBeenCalled();
      expect(ToProto.agentCard).toHaveBeenCalledWith(testAgentCard);
      const [err, response] = callback.mock.calls[0];
      assert.isNull(err);
      assert.deepEqual(response, mockProtoAgentCard);
      expect(call.sendMetadata).toHaveBeenCalled();
    });

    it('should return gRPC error code on failure', async () => {
      (mockRequestHandler.getAgentCard as Mock).mockRejectedValue(
        new A2AError(-32001, 'Not Found')
      );
      const call = createMockUnaryCall({});
      const callback = vi.fn();

      await handler.getAgentCard(call, callback);

      const [err] = callback.mock.calls[0];
      assert.equal(err.code, grpc.status.NOT_FOUND);
      assert.equal(err.details, 'Not Found');
    });
  });

  describe('sendMessage', () => {
    it('should successfully send a message and return a task', async () => {
      const call = createMockUnaryCall({ message: { role: 'user', parts: [] } });
      const callback = vi.fn();

      const messageSendParams = { message: { role: 'user' } } as MessageSendParams;
      (FromProto.messageSendParams as Mock).mockReturnValue(messageSendParams);
      const sendMessageResponse = {
        payload: { $case: 'task', value: { id: 'task-1' } } as proto.SendMessageResponse,
      };
      (ToProto.messageSendResult as Mock).mockReturnValue(sendMessageResponse);
      await handler.sendMessage(call, callback);

      const [err, response] = callback.mock.calls[0];
      assert.isNull(err);
      assert.equal(response.payload.$case, 'task');
      assert.equal(response.payload.value.id, testTask.id);
    });
  });

  describe('sendStreamingMessage', () => {
    it('should stream multiple parts and end correctly', async () => {
      async function* mockStream() {
        yield { kind: 'message', messageId: 'm1' };
        yield { kind: 'task', id: 't1' };
      }
      (mockRequestHandler.sendMessageStream as Mock).mockResolvedValue(mockStream());

      const call = createMockWritableStream({ message: { role: 'user', parts: [] } });

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
          code: grpc.status.INTERNAL,
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

      (FromProto.taskQueryParams as Mock).mockReturnValue({ id: 'task-1' });
      (ToProto.task as Mock).mockReturnValue({ id: 'task-1', contextId: 'ctx-1' });
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

      (FromProto.taskQueryParams as Mock).mockReturnValue({ id: 'task-1' });
      (ToProto.task as Mock).mockReturnValue({ id: 'task-1', contextId: 'ctx-1' });
      await handler.getTask(call, callback);

      const [metadata] = (call.sendMetadata as Mock).mock.calls[0];
      expect(metadata).toBeDefined();
      expect(metadata.get(HTTP_EXTENSION_HEADER.toLowerCase())).toEqual(['extension-v1']);
    });
  });
});

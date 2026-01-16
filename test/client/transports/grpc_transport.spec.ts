import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from 'vitest';
import { credentials, Metadata, ServiceError, status } from '@grpc/grpc-js';
import {
  GrpcTransport,
  GrpcTransportFactory,
} from '../../../src/client/transports/grpc/grpc_transport.js';
import { A2AServiceClient } from '../../../src/grpc/pb/a2a_services.js';
import { ToProto } from '../../../src/types/converters/to_proto.js';
import { FromProto } from '../../../src/types/converters/from_proto.js';
import {
  TaskNotFoundError,
  TaskNotCancelableError,
  PushNotificationNotSupportedError,
} from '../../../src/errors.js';
import {
  createMessageParams,
  createMockAgentCard,
  createMockMessage,
  createMockTask,
} from '../util.js';

// --- Mocks ---

// Mock the gRPC client class
vi.mock('../../../src/grpc/pb/a2a_services.js', () => {
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
  return { A2AServiceClient };
});

// Mock ToProto and FromProto to act as pass-throughs or return simple objects for testing flow
vi.mock('../../../src/types/converters/to_proto.js', () => ({
  ToProto: {
    agentCard: vi.fn((x) => x),
    messageSendParams: vi.fn((x) => x),
    taskPushNotificationConfig: vi.fn((x) => x),
    getTaskPushNotificationConfigParams: vi.fn((x) => x),
    listTaskPushNotificationConfigParams: vi.fn((x) => x),
    deleteTaskPushNotificationConfigParams: vi.fn((x) => x),
    getTaskRequest: vi.fn((x) => x),
    cancelTaskRequest: vi.fn((x) => x),
    taskIdParams: vi.fn((x) => x),
    taskPushNotificationConfigCreate: vi.fn((x) => x),
    taskQueryParams: vi.fn((x) => x),
    getAgentCardRequest: vi.fn((x) => x),
  },
}));

vi.mock('../../../src/types/converters/from_proto.js', () => ({
  FromProto: {
    agentCard: vi.fn((x) => x),
    sendMessageResult: vi.fn((x) => x),
    message: vi.fn((x) => x),
    setTaskPushNotificationConfigParams: vi.fn((x) => x),
    getTaskPushNoticationConfig: vi.fn((x) => x),
    listTaskPushNotificationConfig: vi.fn((x) => x),
    task: vi.fn((x) => x),
    taskStatusUpdate: vi.fn((x) => x),
    taskArtifactUpdate: vi.fn((x) => x),
    taskPushNotificationConfig: vi.fn((x) => x),
    messageStreamResult: vi.fn((x) => x),
  },
}));

describe('GrpcTransport', () => {
  let transport: GrpcTransport;
  let mockGrpcClient: A2AServiceClient;
  const endpoint = 'localhost:50051';

  // Helper to simulate a successful gRPC unary callback
  const mockUnarySuccess = (method: Mock, response: any) => {
    method.mockImplementation((_req: any, _meta: any, _opts: any, callback: any) => {
      callback(null, response);
      return {};
    });
  };

  // Helper to simulate a gRPC error
  const mockUnaryError = (method: Mock, code: number, message: string) => {
    method.mockImplementation((_req: any, _meta: any, _opts: any, callback: any) => {
      const error: Partial<ServiceError> = {
        code: code,
        details: message,
      };
      callback(error, null);
      return {};
    });
  };

  beforeEach(() => {
    mockGrpcClient = new A2AServiceClient(endpoint, credentials.createInsecure());
    transport = new GrpcTransport({ endpoint });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getExtendedAgentCard', () => {
    it('should get agent card successfully', async () => {
      const mockCard = createMockAgentCard();
      mockUnarySuccess(mockGrpcClient.getAgentCard as Mock, mockCard);

      const result = await transport.getExtendedAgentCard();

      expect(result).toEqual(mockCard);
      expect(mockGrpcClient.getAgentCard).toHaveBeenCalled();
      expect(FromProto.agentCard).toHaveBeenCalledWith(mockCard);
    });
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      const params = createMessageParams();
      const mockResult = createMockMessage();
      mockUnarySuccess(mockGrpcClient.sendMessage as Mock, mockResult);

      const result = await transport.sendMessage(params);

      expect(result).toEqual(mockResult);
      expect(ToProto.messageSendParams).toHaveBeenCalledWith(params);
      expect(mockGrpcClient.sendMessage).toHaveBeenCalled();
    });

    it('should pass service parameters as metadata', async () => {
      const params = createMessageParams();
      const options = { serviceParameters: { 'x-test-header': 'test-value' } };
      mockUnarySuccess(mockGrpcClient.sendMessage as Mock, {});

      await transport.sendMessage(params, options);

      const calledMetadata = (mockGrpcClient.sendMessage as Mock).mock.calls[0][1] as Metadata;
      expect(calledMetadata.get('x-test-header')).toEqual(['test-value']);
    });

    it('should throw TaskNotFoundError when mapped from A2A error code', async () => {
      const params = createMessageParams();
      mockUnaryError(mockGrpcClient.sendMessage as Mock, status.NOT_FOUND, 'Task Missing');

      await expect(transport.sendMessage(params)).rejects.toThrow(TaskNotFoundError);
    });

    it('should throw generic Error for unmapped gRPC errors', async () => {
      const params = createMessageParams();
      mockUnaryError(mockGrpcClient.sendMessage as Mock, status.UNKNOWN, 'Internal Error');

      await expect(transport.sendMessage(params)).rejects.toThrow('GRPC error for sendMessage');
    });
  });

  describe('sendMessageStream', () => {
    it('should yield messages from stream', async () => {
      const params = createMessageParams();
      const mockMsg = createMockMessage();
      const mockMsgResponse = { payload: { $case: 'msg', value: mockMsg } };

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield mockMsgResponse;
        },
        cancel: vi.fn(),
      };
      (mockGrpcClient.sendStreamingMessage as Mock).mockReturnValue(mockStream);

      const iterator = transport.sendMessageStream(params);
      const result = await iterator.next();

      expect(result.value).toEqual(mockMsgResponse);
      expect(FromProto.messageStreamResult).toHaveBeenCalledWith(mockMsgResponse);
      expect(mockGrpcClient.sendStreamingMessage).toHaveBeenCalled();
    });

    it('should handle stream errors', async () => {
      const params = createMessageParams();
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          throw { code: 13, message: 'Stream failed' };
          yield {};
        },
        cancel: vi.fn(),
      };
      (mockGrpcClient.sendStreamingMessage as Mock).mockReturnValue(mockStream);

      const iterator = transport.sendMessageStream(params);
      await expect(iterator.next()).rejects.toThrow('GRPC error for sendStreamingMessage!');
    });
  });

  describe('getTask', () => {
    it('should get task successfully', async () => {
      const taskId = 'task-123';
      const mockTask = createMockTask(taskId);
      mockUnarySuccess(mockGrpcClient.getTask as Mock, mockTask);

      const result = await transport.getTask({ id: taskId });

      expect(result).toEqual(mockTask);
      expect(ToProto.taskQueryParams).toHaveBeenCalled();
      expect(mockGrpcClient.getTask).toHaveBeenCalled();
    });

    it('should throw TaskNotFoundError', async () => {
      mockUnaryError(mockGrpcClient.getTask as Mock, status.NOT_FOUND, 'Not Found');
      await expect(transport.getTask({ id: 'bad-id' })).rejects.toThrow(TaskNotFoundError);
    });
  });

  describe('cancelTask', () => {
    it('should cancel task successfully', async () => {
      const taskId = 'task-123';
      const mockTask = createMockTask(taskId, 'canceled');
      mockUnarySuccess(mockGrpcClient.cancelTask as Mock, mockTask);

      const result = await transport.cancelTask({ id: taskId });

      expect(result).toEqual(mockTask);
      expect(mockGrpcClient.cancelTask).toHaveBeenCalled();
    });

    it('should throw TaskNotCancelableError', async () => {
      mockUnaryError(
        mockGrpcClient.cancelTask as Mock,
        status.FAILED_PRECONDITION,
        'Cannot cancel'
      );
      await expect(transport.cancelTask({ id: 'task-123' })).rejects.toThrow(
        TaskNotCancelableError
      );
    });
  });

  describe('Push Notification Config', () => {
    const taskId = 'task-123';
    const configId = 'config-456';
    const mockConfig = {
      taskId,
      pushNotificationConfig: { id: configId, url: 'http://test' },
    };

    describe('setTaskPushNotificationConfig', () => {
      it('should set config successfully', async () => {
        mockUnarySuccess(mockGrpcClient.createTaskPushNotificationConfig as Mock, mockConfig);

        const result = await transport.setTaskPushNotificationConfig(mockConfig);

        expect(result).toEqual(mockConfig);
        expect(mockGrpcClient.createTaskPushNotificationConfig).toHaveBeenCalled();
      });

      it('should throw PushNotificationNotSupportedError', async () => {
        mockUnaryError(
          mockGrpcClient.createTaskPushNotificationConfig as Mock,
          status.UNIMPLEMENTED,
          'Not supported'
        );
        await expect(transport.setTaskPushNotificationConfig(mockConfig)).rejects.toThrow(
          PushNotificationNotSupportedError
        );
      });
    });

    describe('getTaskPushNotificationConfig', () => {
      it('should get config successfully', async () => {
        mockUnarySuccess(mockGrpcClient.getTaskPushNotificationConfig as Mock, mockConfig);

        const result = await transport.getTaskPushNotificationConfig({
          id: taskId,
          pushNotificationConfigId: configId,
        });

        expect(result).toEqual(mockConfig);
      });
    });

    describe('listTaskPushNotificationConfig', () => {
      it('should list configs successfully', async () => {
        const mockList = [mockConfig];
        mockUnarySuccess(mockGrpcClient.listTaskPushNotificationConfig as Mock, mockList);

        const result = await transport.listTaskPushNotificationConfig({ id: taskId });

        expect(result).toEqual(mockList);
      });
    });

    describe('deleteTaskPushNotificationConfig', () => {
      it('should delete config successfully', async () => {
        mockUnarySuccess(mockGrpcClient.deleteTaskPushNotificationConfig as Mock, {});

        await transport.deleteTaskPushNotificationConfig({
          id: taskId,
          pushNotificationConfigId: configId,
        });

        expect(mockGrpcClient.deleteTaskPushNotificationConfig).toHaveBeenCalled();
      });
    });
  });

  describe('resubscribeTask', () => {
    it('should yield task updates from stream', async () => {
      const params = { id: 'task-123' };
      const mockUpdate = createMockTask('task-123');
      const mockResponse = { payload: { $case: 'task', value: mockUpdate } };

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield mockResponse;
        },
        cancel: vi.fn(),
      };
      (mockGrpcClient.taskSubscription as Mock).mockReturnValue(mockStream);

      const iterator = transport.resubscribeTask(params);
      const result = await iterator.next();

      expect(result.value).toEqual(mockResponse);
      expect(FromProto.messageStreamResult).toHaveBeenCalledWith(mockResponse);
    });
  });
});

describe('GrpcTransportFactory', () => {
  it('should have correct protocol name', () => {
    const factory = new GrpcTransportFactory();
    expect(factory.protocolName).toBe('GRPC');
  });

  it('should create transport with correct endpoint', async () => {
    const factory = new GrpcTransportFactory();
    const agentCard = createMockAgentCard({ url: 'localhost:50051' });
    const transport = await factory.create(agentCard.url, agentCard);

    expect(transport).toBeInstanceOf(GrpcTransport);
  });
});

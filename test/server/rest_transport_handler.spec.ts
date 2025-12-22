import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from 'vitest';

import {
  RestTransportHandler,
  mapErrorToStatus,
  toHTTPError,
  HTTP_STATUS,
} from '../../src/server/transports/rest/rest_transport_handler.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { A2AError } from '../../src/server/error.js';
import { A2A_ERROR_CODE } from '../../src/errors.js';
import { AgentCard, Task, Message } from '../../src/types.js';
import { ServerCallContext } from '../../src/server/context.js';

describe('RestTransportHandler', () => {
  let mockRequestHandler: A2ARequestHandler;
  let transportHandler: RestTransportHandler;
  let mockContext: ServerCallContext;

  const testAgentCard: AgentCard = {
    protocolVersion: '0.3.0',
    name: 'Test Agent',
    description: 'An agent for testing purposes',
    url: 'http://localhost:8080',
    preferredTransport: 'HTTP+JSON',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: true,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
  };

  const testMessage: Message = {
    messageId: 'msg-1',
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: 'Hello' }],
    kind: 'message' as const,
  };

  const testTask: Task = {
    id: 'task-1',
    kind: 'task' as const,
    status: { state: 'completed' as const },
    contextId: 'ctx-1',
    history: [],
  };

  beforeEach(() => {
    mockRequestHandler = {
      getAgentCard: vi.fn().mockResolvedValue(testAgentCard),
      getAuthenticatedExtendedAgentCard: vi.fn().mockResolvedValue(testAgentCard),
      sendMessage: vi.fn().mockResolvedValue(testTask),
      sendMessageStream: vi.fn(),
      getTask: vi.fn().mockResolvedValue(testTask),
      cancelTask: vi.fn().mockResolvedValue(testTask),
      setTaskPushNotificationConfig: vi.fn(),
      getTaskPushNotificationConfig: vi.fn(),
      listTaskPushNotificationConfigs: vi.fn(),
      deleteTaskPushNotificationConfig: vi.fn(),
      resubscribe: vi.fn(),
    };
    transportHandler = new RestTransportHandler(mockRequestHandler);
    mockContext = new ServerCallContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mapErrorToStatus', () => {
    it.each([
      [A2A_ERROR_CODE.PARSE_ERROR, HTTP_STATUS.BAD_REQUEST],
      [A2A_ERROR_CODE.INVALID_REQUEST, HTTP_STATUS.BAD_REQUEST],
      [A2A_ERROR_CODE.INVALID_PARAMS, HTTP_STATUS.BAD_REQUEST],
      [A2A_ERROR_CODE.METHOD_NOT_FOUND, HTTP_STATUS.NOT_FOUND],
      [A2A_ERROR_CODE.TASK_NOT_FOUND, HTTP_STATUS.NOT_FOUND],
      [A2A_ERROR_CODE.TASK_NOT_CANCELABLE, HTTP_STATUS.CONFLICT],
      [A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED, HTTP_STATUS.BAD_REQUEST],
      [A2A_ERROR_CODE.UNSUPPORTED_OPERATION, HTTP_STATUS.BAD_REQUEST],
      [-99999, HTTP_STATUS.INTERNAL_SERVER_ERROR],
    ])('should map error code %s to HTTP status %s', (errorCode, httpStatus) => {
      expect(mapErrorToStatus(errorCode)).to.equal(httpStatus);
    });
  });

  describe('toHTTPError', () => {
    it('should convert A2AError to HTTP error format', () => {
      const error = A2AError.invalidParams('Invalid input');
      const httpError = toHTTPError(error);

      expect(httpError.code).to.equal(A2A_ERROR_CODE.INVALID_PARAMS);
      expect(httpError.message).to.equal('Invalid input');
      expect(httpError.data).to.be.undefined;
    });

    it('should include data if present in A2AError', () => {
      const error = A2AError.invalidParams('Invalid input');
      error.data = { field: 'email' };
      const httpError = toHTTPError(error);

      expect(httpError.data).to.deep.equal({ field: 'email' });
    });
  });

  describe('getAgentCard', () => {
    it('should return agent card from request handler', async () => {
      const card = await transportHandler.getAgentCard();

      expect(card).to.deep.equal(testAgentCard);
      expect(mockRequestHandler.getAgentCard as Mock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAuthenticatedExtendedAgentCard', () => {
    it('should return extended agent card from request handler', async () => {
      const card = await transportHandler.getAuthenticatedExtendedAgentCard(mockContext);

      expect(card).to.deep.equal(testAgentCard);
      expect(mockRequestHandler.getAuthenticatedExtendedAgentCard as Mock).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendMessage', () => {
    it.each([
      {
        name: 'camelCase',
        input: {
          message: {
            messageId: 'msg-1',
            role: 'user' as const,
            parts: [{ kind: 'text' as const, text: 'Hello' }],
            kind: 'message' as const,
          },
        },
        expectedMessageId: 'msg-1',
      },
      {
        name: 'snake_case',
        input: {
          message: {
            message_id: 'msg-2',
            role: 'user' as const,
            parts: [{ kind: 'text' as const, text: 'Hello snake' }],
            kind: 'message' as const,
          },
        },
        expectedMessageId: 'msg-2',
      },
    ])(
      'should normalize $name message and call request handler',
      async ({ input, expectedMessageId }) => {
        const result = await transportHandler.sendMessage(input as any, mockContext);

        expect(result).to.deep.equal(testTask);
        expect(mockRequestHandler.sendMessage as Mock).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.objectContaining({ messageId: expectedMessageId }),
          }),
          mockContext
        );
      }
    );

    it('should throw InvalidParams if message is missing', async () => {
      await expect(transportHandler.sendMessage({} as any, mockContext)).rejects.toThrow(
        'message is required'
      );
    });

    it('should throw InvalidParams if message.messageId is missing', async () => {
      const invalidMessage = {
        message: {
          role: 'user' as const,
          parts: [{ kind: 'text' as const, text: 'Hello' }],
          kind: 'message' as const,
        },
      };

      await expect(
        transportHandler.sendMessage(invalidMessage as any, mockContext)
      ).rejects.toThrow('message.messageId is required');
    });

    it('should normalize configuration with snake_case fields', async () => {
      const inputWithConfig = {
        message: testMessage,
        configuration: {
          accepted_output_modes: ['text/plain'],
          history_length: 5,
        },
      };

      await transportHandler.sendMessage(inputWithConfig as any, mockContext);

      expect(mockRequestHandler.sendMessage as Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: expect.objectContaining({
            acceptedOutputModes: ['text/plain'],
            historyLength: 5,
          }),
        }),
        mockContext
      );
    });
  });

  describe('sendMessageStream', () => {
    it('should throw UnsupportedOperation if streaming not supported', async () => {
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue({
        ...testAgentCard,
        capabilities: { streaming: false },
      });

      await expect(
        transportHandler.sendMessageStream({ message: testMessage }, mockContext)
      ).rejects.toThrow('Agent does not support streaming');
    });

    it('should call request handler sendMessageStream if streaming supported', async () => {
      async function* mockStream() {
        yield testMessage;
      }
      (mockRequestHandler.sendMessageStream as Mock).mockResolvedValue(mockStream());

      const stream = await transportHandler.sendMessageStream(
        { message: testMessage },
        mockContext
      );

      expect(stream).toBeDefined();
      expect(mockRequestHandler.sendMessageStream as Mock).toHaveBeenCalled();
    });
  });

  describe('getTask', () => {
    it('should get task by ID', async () => {
      const result = await transportHandler.getTask('task-1', mockContext);

      expect(result).to.deep.equal(testTask);
      expect(mockRequestHandler.getTask as Mock).toHaveBeenCalledWith(
        { id: 'task-1' },
        mockContext
      );
    });

    it('should include historyLength if provided', async () => {
      await transportHandler.getTask('task-1', mockContext, '10');

      expect(mockRequestHandler.getTask as Mock).toHaveBeenCalledWith(
        { id: 'task-1', historyLength: 10 },
        mockContext
      );
    });

    it('should throw InvalidParams if historyLength is invalid', async () => {
      await expect(transportHandler.getTask('task-1', mockContext, 'invalid')).rejects.toThrow(
        'historyLength must be a valid integer'
      );
    });

    it('should throw InvalidParams if historyLength is negative', async () => {
      await expect(transportHandler.getTask('task-1', mockContext, '-5')).rejects.toThrow(
        'historyLength must be non-negative'
      );
    });
  });

  describe('cancelTask', () => {
    it('should cancel task by ID', async () => {
      const cancelledTask = { ...testTask, status: { state: 'canceled' as const } };
      (mockRequestHandler.cancelTask as Mock).mockResolvedValue(cancelledTask);

      const result = await transportHandler.cancelTask('task-1', mockContext);

      expect(result.status.state).to.equal('canceled');
      expect(mockRequestHandler.cancelTask as Mock).toHaveBeenCalledWith(
        { id: 'task-1' },
        mockContext
      );
    });
  });

  describe('resubscribe', () => {
    it('should throw UnsupportedOperation if streaming not supported', async () => {
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue({
        ...testAgentCard,
        capabilities: { streaming: false },
      });

      await expect(transportHandler.resubscribe('task-1', mockContext)).rejects.toThrow(
        'Agent does not support streaming'
      );
    });

    it('should call request handler resubscribe if streaming supported', async () => {
      async function* mockStream() {
        yield testTask;
      }
      (mockRequestHandler.resubscribe as Mock).mockResolvedValue(mockStream());

      const stream = await transportHandler.resubscribe('task-1', mockContext);

      expect(stream).toBeDefined();
      expect(mockRequestHandler.resubscribe as Mock).toHaveBeenCalledWith(
        { id: 'task-1' },
        mockContext
      );
    });
  });

  describe('Push Notification Config', () => {
    const mockConfig = {
      taskId: 'task-1',
      pushNotificationConfig: {
        id: 'config-1',
        url: 'https://example.com/webhook',
      },
    };

    describe('setTaskPushNotificationConfig', () => {
      it('should throw PushNotificationNotSupported if not supported', async () => {
        (mockRequestHandler.getAgentCard as Mock).mockResolvedValue({
          ...testAgentCard,
          capabilities: { pushNotifications: false },
        });

        await expect(
          transportHandler.setTaskPushNotificationConfig(mockConfig, mockContext)
        ).rejects.toThrow('Push Notification is not supported');
      });

      it('should normalize and set config if supported', async () => {
        (mockRequestHandler.setTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const result = await transportHandler.setTaskPushNotificationConfig(
          mockConfig,
          mockContext
        );

        expect(result).to.deep.equal(mockConfig);
      });

      it('should normalize snake_case config', async () => {
        (mockRequestHandler.setTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const snakeCaseConfig = {
          task_id: 'task-1',
          push_notification_config: {
            id: 'config-1',
            url: 'https://example.com/webhook',
          },
        };

        await transportHandler.setTaskPushNotificationConfig(snakeCaseConfig as any, mockContext);

        expect(mockRequestHandler.setTaskPushNotificationConfig as Mock).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: 'task-1',
            pushNotificationConfig: expect.objectContaining({ id: 'config-1' }),
          }),
          mockContext
        );
      });

      it('should throw InvalidParams if taskId is missing', async () => {
        const invalidConfig = {
          pushNotificationConfig: { id: 'config-1', url: 'https://example.com/webhook' },
        };

        await expect(
          transportHandler.setTaskPushNotificationConfig(invalidConfig as any, mockContext)
        ).rejects.toThrow('taskId is required');
      });

      it('should throw InvalidParams if pushNotificationConfig is missing', async () => {
        const invalidConfig = {
          taskId: 'task-1',
        };

        await expect(
          transportHandler.setTaskPushNotificationConfig(invalidConfig as any, mockContext)
        ).rejects.toThrow('pushNotificationConfig is required');
      });
    });

    describe('listTaskPushNotificationConfigs', () => {
      it('should list configs for task', async () => {
        const configs = [mockConfig];
        (mockRequestHandler.listTaskPushNotificationConfigs as Mock).mockResolvedValue(configs);

        const result = await transportHandler.listTaskPushNotificationConfigs(
          'task-1',
          mockContext
        );

        expect(result).to.deep.equal(configs);
        expect(mockRequestHandler.listTaskPushNotificationConfigs as Mock).toHaveBeenCalledWith(
          { id: 'task-1' },
          mockContext
        );
      });
    });

    describe('getTaskPushNotificationConfig', () => {
      it('should get specific config', async () => {
        (mockRequestHandler.getTaskPushNotificationConfig as Mock).mockResolvedValue(mockConfig);

        const result = await transportHandler.getTaskPushNotificationConfig(
          'task-1',
          'config-1',
          mockContext
        );

        expect(result).to.deep.equal(mockConfig);
        expect(mockRequestHandler.getTaskPushNotificationConfig as Mock).toHaveBeenCalledWith(
          { id: 'task-1', pushNotificationConfigId: 'config-1' },
          mockContext
        );
      });
    });

    describe('deleteTaskPushNotificationConfig', () => {
      it('should delete specific config', async () => {
        (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockResolvedValue(undefined);

        await transportHandler.deleteTaskPushNotificationConfig('task-1', 'config-1', mockContext);

        expect(mockRequestHandler.deleteTaskPushNotificationConfig as Mock).toHaveBeenCalledWith(
          { id: 'task-1', pushNotificationConfigId: 'config-1' },
          mockContext
        );
      });
    });
  });

  describe('File parts normalization', () => {
    it.each([
      {
        name: 'camelCase',
        message: {
          messageId: 'msg-file',
          role: 'user' as const,
          parts: [
            {
              kind: 'file' as const,
              file: {
                uri: 'https://example.com/file.pdf',
                mimeType: 'application/pdf',
                name: 'document.pdf',
              },
            },
          ],
          kind: 'message' as const,
        },
      },
      {
        name: 'snake_case',
        message: {
          message_id: 'msg-file',
          role: 'user' as const,
          parts: [
            {
              kind: 'file' as const,
              file: {
                uri: 'https://example.com/file.pdf',
                mime_type: 'application/pdf',
                name: 'document.pdf',
              },
            },
          ],
          kind: 'message' as const,
        },
      },
    ])('should normalize $name file parts to camelCase', async ({ message }) => {
      await transportHandler.sendMessage({ message } as any, mockContext);

      expect(mockRequestHandler.sendMessage as Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            parts: [
              expect.objectContaining({
                kind: 'file',
                file: expect.objectContaining({ mimeType: 'application/pdf' }),
              }),
            ],
          }),
        }),
        mockContext
      );
    });
  });
});

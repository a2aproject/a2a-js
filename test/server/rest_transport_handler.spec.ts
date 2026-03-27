import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from 'vitest';

import {
  RestTransportHandler,
  mapErrorToStatus,
  toHTTPError,
  HTTP_STATUS,
} from '../../src/server/transports/rest/rest_transport_handler.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import {
  RequestMalformedError,
  TaskNotFoundError,
  TaskNotCancelableError,
  PushNotificationNotSupportedError,
  UnsupportedOperationError,
} from '../../src/errors.js';
import { AgentCard, Task, Message, Role, TaskState, TaskStatus } from '../../src/index.js';
import { ServerCallContext } from '../../src/server/context.js';

describe('RestTransportHandler', () => {
  let mockRequestHandler: A2ARequestHandler;
  let transportHandler: RestTransportHandler;
  let mockContext: ServerCallContext;

  const testAgentCard = {    name: 'Test Agent',
    description: 'An agent for testing purposes',
    url: 'http://localhost:8080',    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extensions: [] as any[],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [] as any[],
    provider: undefined,
    documentationUrl: '',
    securitySchemes: {},
    securityRequirements: [] as any[],    signatures: [] as any[],  };

  const testMessage: Message = {
    messageId: 'msg-1',
    role: Role.ROLE_USER,
    parts: [{ content: { $case: 'text', value: 'Hello' } }],
    contextId: 'ctx-1',
    taskId: '',
    extensions: [] as any[],
    metadata: {}, 
  };

  const testTask: Task = {
    id: 'task-1',
    status: {
      state: TaskState.TASK_STATE_COMPLETED,
      message: undefined,
      timestamp: undefined,
    } as TaskStatus,
    contextId: 'ctx-1',
    history: [] as any[],
    artifacts: [] as any[],
    metadata: {}, 
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
      [new RequestMalformedError(''), HTTP_STATUS.BAD_REQUEST],
      [new TaskNotFoundError(''), HTTP_STATUS.NOT_FOUND],
      [new TaskNotCancelableError(''), HTTP_STATUS.CONFLICT],
      [new PushNotificationNotSupportedError(''), HTTP_STATUS.BAD_REQUEST],
      [new UnsupportedOperationError(''), HTTP_STATUS.BAD_REQUEST],
      [new Error(''), HTTP_STATUS.INTERNAL_SERVER_ERROR],
    ])('should map error %s to HTTP status %s', (error, httpStatus) => {
      expect(mapErrorToStatus(error)).to.equal(httpStatus);
    });
  });

  describe('toHTTPError', () => {
    it('should convert A2AError to HTTP error format', () => {
      const error = new RequestMalformedError('Invalid input');
      const httpError = toHTTPError(error);

      expect(httpError.name).to.equal('RequestMalformedError');
      expect(httpError.message).to.equal('Invalid input');
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
            role: Role.ROLE_USER,
            parts: [{ content: { $case: 'text', value: 'Hello' } }],
            contextId: '',
            taskId: '',
            extensions: [] as any[],
            metadata: {}, 
          },
          metadata: {}, 
          configuration: undefined,
        },
        expectedMessageId: 'msg-1',
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

    it('should throw InvalidParams if request is missing', async () => {
      await expect(transportHandler.sendMessage({} as any, mockContext)).rejects.toThrow(
        'message is required'
      );
    });

    it('should throw InvalidParams if request.messageId is missing', async () => {
      const invalidMessage = {
        message: {
          role: Role.ROLE_USER as const,
          parts: [{ content: { $case: 'text', text: 'Hello' } }],
          kind: 'message' as const,
        },
        metadata: {}, 
        configuration: undefined as any,
      };

      await expect(
        transportHandler.sendMessage(invalidMessage as any, mockContext)
      ).rejects.toThrow('message.messageId is required');
    });
  });

  describe('sendMessageStream', () => {
    it('should throw UnsupportedOperation if streaming not supported', async () => {
      (mockRequestHandler.getAgentCard as Mock).mockResolvedValue({
        ...testAgentCard,
        capabilities: { streaming: false },
      });

      await expect(
        transportHandler.sendMessageStream(
          { message: testMessage, metadata: {}, configuration: undefined },
          mockContext
        )
      ).rejects.toThrow('Agent does not support streaming');
    });

    it('should call request handler sendMessageStream if streaming supported', async () => {
      async function* mockStream() {
        yield testMessage;
      }
      (mockRequestHandler.sendMessageStream as Mock).mockResolvedValue(mockStream());

      const stream = await transportHandler.sendMessageStream(
        { message: testMessage, metadata: {}, configuration: undefined },
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
        { id: 'task-1', tenant: '', historyLength: 0 },
        mockContext
      );
    });

    it('should include historyLength if provided', async () => {
      await transportHandler.getTask('task-1', mockContext, '10');

      expect(mockRequestHandler.getTask as Mock).toHaveBeenCalledWith(
        { id: 'task-1', tenant: '', historyLength: 10 },
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
      const cancelledTask = {
        ...testTask,
        status: {
          state: TaskState.TASK_STATE_CANCELED,
          message: undefined,
          timestamp: undefined,
        } as TaskStatus,
      };
      (mockRequestHandler.cancelTask as Mock).mockResolvedValue(cancelledTask);

      const result = await transportHandler.cancelTask('task-1', mockContext);

      expect(result.status?.state).to.equal(TaskState.TASK_STATE_CANCELED);
      expect(mockRequestHandler.cancelTask as Mock).toHaveBeenCalledWith(
        { id: 'task-1', tenant: '' },
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
        { id: 'task-1', tenant: '' },
        mockContext
      );
    });
  });

  describe('Push Notification Config', () => {
    const mockConfig: TaskPushNotificationConfig = {
      taskId: 'task-1',
      id: 'config-1',
      url: 'https://example.com/webhook',
      tenant: '',
      token: '',
      authentication: undefined,
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
        (mockRequestHandler.setTaskPushNotificationConfig as Mock).mockResolvedValue(
          mockConfig
        );

        const result = await transportHandler.setTaskPushNotificationConfig(
          mockConfig,
          mockContext
        );

        expect(result).to.deep.equal(mockConfig);
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
          { taskId: 'task-1', tenant: '', pageSize: 0, pageToken: '' },
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
          { taskId: 'task-1', id: 'config-1', tenant: '' },
          mockContext
        );
      });
    });

    describe('deleteTaskPushNotificationConfig', () => {
      it('should delete specific config', async () => {
        (mockRequestHandler.deleteTaskPushNotificationConfig as Mock).mockResolvedValue(undefined);

        await transportHandler.deleteTaskPushNotificationConfig('task-1', 'config-1', mockContext);

        expect(mockRequestHandler.deleteTaskPushNotificationConfig as Mock).toHaveBeenCalledWith(
          { taskId: 'task-1', id: 'config-1', tenant: '' },
          mockContext
        );
      });
    });
  });

  describe('File parts normalization', () => {
    it.each([
      {
        name: 'camelCase',
        request: {
          messageId: 'msg-file',
          role: Role.ROLE_USER,
          parts: [
            {
              content: {
                $case: 'file',
                value: {
                  file: {
                    $case: 'fileWithUri',
                    value: 'https://example.com/file.pdf',
                  },
                  mimeType: 'application/pdf',
                },
              },
            },
          ],
          contextId: '',
          taskId: '',
          extensions: [] as any[],
          metadata: {}, 
        },
        metadata: {}, 
        configuration: undefined,
      },
    ])(
      'should normalize $name file parts to camelCase',
      async ({ request, metadata, configuration }) => {
        await transportHandler.sendMessage(
          { message: request, metadata, configuration } as any,
          mockContext
        );

        expect(mockRequestHandler.sendMessage as Mock).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.objectContaining({
              parts: [
                expect.objectContaining({
                  content: {
                    $case: 'file',
                    value: expect.objectContaining({
                      file: {
                        $case: 'fileWithUri',
                        value: 'https://example.com/file.pdf',
                      },
                      mimeType: 'application/pdf',
                    }),
                  },
                }),
              ],
            }),
          }),
          mockContext
        );
      }
    );
  });

});

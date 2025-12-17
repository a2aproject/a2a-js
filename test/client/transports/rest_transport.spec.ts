import {
  RestTransport,
  RestTransportFactory,
} from '../../../src/client/transports/rest_transport.js';
import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from 'vitest';
import { TaskPushNotificationConfig } from '../../../src/types.js';
import { RequestOptions } from '../../../src/client/multitransport-client.js';
import { HTTP_EXTENSION_HEADER } from '../../../src/constants.js';
import { ServiceParameters, withA2AExtensions } from '../../../src/client/service-parameters.js';
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
  createRestResponse,
  createRestErrorResponse,
} from '../util.js';

describe('RestTransport', () => {
  let transport: RestTransport;
  let mockFetch: Mock<typeof fetch>;
  const endpoint = 'https://test.endpoint/api';

  beforeEach(() => {
    mockFetch = vi.fn();
    transport = new RestTransport({
      endpoint,
      fetchImpl: mockFetch,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should trim trailing slashes from endpoint', async () => {
      const trailingSlashTransport = new RestTransport({
        endpoint: 'https://example.com/a2a/rest/',
        fetchImpl: mockFetch,
      });
      const mockResponse = createMockMessage();
      mockFetch.mockResolvedValue(createRestResponse(mockResponse));

      await trailingSlashTransport.sendMessage(createMessageParams());

      const [url] = mockFetch.mock.calls[0];
      expect(url).to.equal('https://example.com/a2a/rest/v1/message:send');
    });

    it('should trim multiple trailing slashes from endpoint', async () => {
      const trailingSlashTransport = new RestTransport({
        endpoint: 'https://example.com/a2a/rest///',
        fetchImpl: mockFetch,
      });
      const mockResponse = createMockMessage();
      mockFetch.mockResolvedValue(createRestResponse(mockResponse));

      await trailingSlashTransport.sendMessage(createMessageParams());

      const [url] = mockFetch.mock.calls[0];
      expect(url).to.equal('https://example.com/a2a/rest/v1/message:send');
    });
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      const messageParams = createMessageParams();
      const mockResponse = createMockMessage();

      mockFetch.mockResolvedValue(createRestResponse(mockResponse));

      const result = await transport.sendMessage(messageParams);

      expect(result).to.deep.equal(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).to.equal(`${endpoint}/v1/message:send`);
      expect(options?.method).to.equal('POST');
      expect((options?.headers as Record<string, string>)['Content-Type']).to.equal(
        'application/json'
      );
    });

    it('should correctly add the extension headers', async () => {
      const messageParams = createMessageParams();
      const expectedExtensions = 'extension1,extension2';
      const serviceParameters = ServiceParameters.create(withA2AExtensions(expectedExtensions));
      const options: RequestOptions = { serviceParameters };

      mockFetch.mockResolvedValue(createRestResponse(createMockMessage()));

      await transport.sendMessage(messageParams, options);

      const fetchArgs = mockFetch.mock.calls[0][1];
      const headers = fetchArgs?.headers as Record<string, string>;
      expect(headers[HTTP_EXTENSION_HEADER]).to.equal(expectedExtensions);
    });

    it('should throw TaskNotFoundError on -32001', async () => {
      const messageParams = createMessageParams();
      mockFetch.mockResolvedValue(createRestErrorResponse(-32001, 'Task not found', 404));

      await expect(transport.sendMessage(messageParams)).rejects.toThrow(TaskNotFoundError);
    });
  });

  describe('getTask', () => {
    it('should get task successfully', async () => {
      const taskId = 'task-123';
      const mockTask = createMockTask(taskId);

      mockFetch.mockResolvedValue(createRestResponse(mockTask));

      const result = await transport.getTask({ id: taskId });

      expect(result).to.deep.equal(mockTask);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).to.equal(`${endpoint}/v1/tasks/${taskId}`);
      expect(options?.method).to.equal('GET');
    });

    it('should pass historyLength as query parameter', async () => {
      const taskId = 'task-123';
      const historyLength = 10;
      const mockTask = createMockTask(taskId);

      mockFetch.mockResolvedValue(createRestResponse(mockTask));

      const result = await transport.getTask({ id: taskId, historyLength });

      expect(result).to.deep.equal(mockTask);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).to.equal(`${endpoint}/v1/tasks/${taskId}?historyLength=${historyLength}`);
    });

    it('should throw TaskNotFoundError when task does not exist', async () => {
      mockFetch.mockResolvedValue(createRestErrorResponse(-32001, 'Task not found', 404));

      await expect(transport.getTask({ id: 'nonexistent' })).rejects.toThrow(TaskNotFoundError);
    });
  });

  describe('cancelTask', () => {
    it('should cancel task successfully', async () => {
      const taskId = 'task-123';
      const mockTask = createMockTask(taskId, 'canceled');

      mockFetch.mockResolvedValue(createRestResponse(mockTask));

      const result = await transport.cancelTask({ id: taskId });

      expect(result).to.deep.equal(mockTask);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).to.equal(`${endpoint}/v1/tasks/${taskId}:cancel`);
      expect(options?.method).to.equal('POST');
    });

    it('should throw TaskNotCancelableError on -32002', async () => {
      mockFetch.mockResolvedValue(createRestErrorResponse(-32002, 'Task cannot be canceled', 409));

      await expect(transport.cancelTask({ id: 'task-123' })).rejects.toThrow(
        TaskNotCancelableError
      );
    });
  });

  describe('getExtendedAgentCard', () => {
    it('should get extended agent card successfully', async () => {
      const mockCard = {
        name: 'Test Agent',
        url: endpoint,
        version: '1.0.0',
        protocolVersion: '0.3.0',
      };

      mockFetch.mockResolvedValue(createRestResponse(mockCard));

      const result = await transport.getExtendedAgentCard();

      expect(result).to.deep.equal(mockCard);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).to.equal(`${endpoint}/v1/card`);
      expect(options?.method).to.equal('GET');
    });
  });

  describe('Push Notification Config', () => {
    const taskId = 'task-123';
    const configId = 'config-456';
    const mockConfig: TaskPushNotificationConfig = {
      taskId,
      pushNotificationConfig: {
        id: configId,
        url: 'https://notify.example.com/webhook',
      },
    };

    describe('setTaskPushNotificationConfig', () => {
      it('should set push notification config successfully', async () => {
        mockFetch.mockResolvedValue(createRestResponse(mockConfig));

        const result = await transport.setTaskPushNotificationConfig(mockConfig);

        expect(result).to.deep.equal(mockConfig);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [url, options] = mockFetch.mock.calls[0];
        expect(url).to.equal(`${endpoint}/v1/tasks/${taskId}/pushNotificationConfigs`);
        expect(options?.method).to.equal('POST');
      });

      it('should throw PushNotificationNotSupportedError on -32003', async () => {
        mockFetch.mockResolvedValue(
          createRestErrorResponse(-32003, 'Push notifications not supported', 400)
        );

        await expect(transport.setTaskPushNotificationConfig(mockConfig)).rejects.toThrow(
          PushNotificationNotSupportedError
        );
      });
    });

    describe('getTaskPushNotificationConfig', () => {
      it('should get push notification config successfully', async () => {
        mockFetch.mockResolvedValue(createRestResponse(mockConfig));

        const result = await transport.getTaskPushNotificationConfig({
          id: taskId,
          pushNotificationConfigId: configId,
        });

        expect(result).to.deep.equal(mockConfig);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [url] = mockFetch.mock.calls[0];
        expect(url).to.equal(`${endpoint}/v1/tasks/${taskId}/pushNotificationConfigs/${configId}`);
      });

      it('should throw error when pushNotificationConfigId is missing', async () => {
        await expect(
          transport.getTaskPushNotificationConfig({
            id: taskId,
            pushNotificationConfigId: undefined as unknown as string,
          })
        ).rejects.toThrow('pushNotificationConfigId is required');
      });
    });

    describe('listTaskPushNotificationConfig', () => {
      it('should list push notification configs successfully', async () => {
        const mockConfigs = [
          mockConfig,
          { ...mockConfig, pushNotificationConfig: { id: 'config-789' } },
        ];
        mockFetch.mockResolvedValue(createRestResponse(mockConfigs));

        const result = await transport.listTaskPushNotificationConfig({ id: taskId });

        expect(result).to.deep.equal(mockConfigs);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [url, options] = mockFetch.mock.calls[0];
        expect(url).to.equal(`${endpoint}/v1/tasks/${taskId}/pushNotificationConfigs`);
        expect(options?.method).to.equal('GET');
      });
    });

    describe('deleteTaskPushNotificationConfig', () => {
      it('should delete push notification config successfully', async () => {
        mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

        await transport.deleteTaskPushNotificationConfig({
          id: taskId,
          pushNotificationConfigId: configId,
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [url, options] = mockFetch.mock.calls[0];
        expect(url).to.equal(`${endpoint}/v1/tasks/${taskId}/pushNotificationConfigs/${configId}`);
        expect(options?.method).to.equal('DELETE');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle HTTP errors with non-JSON response', async () => {
      mockFetch.mockResolvedValue(
        new Response('Internal Server Error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      await expect(transport.getTask({ id: 'task-123' })).rejects.toThrow('HTTP error');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(transport.getTask({ id: 'task-123' })).rejects.toThrow('Network error');
    });
  });
});

describe('RestTransportFactory', () => {
  it('should have correct protocol name', () => {
    const factory = new RestTransportFactory();
    expect(factory.protocolName).to.equal('HTTP+JSON');
  });

  it('should create transport with correct endpoint', async () => {
    const factory = new RestTransportFactory();
    const agentCard = createMockAgentCard({ url: 'https://example.com/api' });
    const transport = await factory.create(agentCard.url, agentCard);
    expect(transport).to.be.instanceOf(RestTransport);
  });
});

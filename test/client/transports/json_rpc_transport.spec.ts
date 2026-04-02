import { JsonRpcTransport } from '../../../src/client/transports/json_rpc_transport.js';
import { describe, it, beforeEach, expect, vi, type Mock } from 'vitest';
import { Role } from '../../../src/index.js';
import {
  GetTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigsRequest,
  SendMessageRequest,
  TaskPushNotificationConfig,
} from '../../../src/types/pb/a2a.js';
import { RequestOptions } from '../../../src/client/multitransport-client.js';
import { HTTP_EXTENSION_HEADER } from '../../../src/constants.js';
import { ServiceParameters, withA2AExtensions } from '../../../src/client/service-parameters.js';

describe('JsonRpcTransport', () => {
  let transport: JsonRpcTransport;
  let mockFetch: Mock<typeof fetch>;
  const endpoint = 'https://test.endpoint/api';

  beforeEach(() => {
    mockFetch = vi.fn();
    transport = new JsonRpcTransport({
      endpoint,
      fetchImpl: mockFetch,
    });
  });

  describe('protocolName', () => {
    it('should return correct protocol name', () => {
      expect(transport.protocolName).to.equal('JSONRPC');
    });
  });

  describe('sendMessage', () => {
    it('should correctly add the extension headers', async () => {
      const messageParams: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: 'test-msg-1',
          role: Role.ROLE_USER,
          parts: [
            {
              content: {
                $case: 'text',
                value: 'Hello, agent!',
              },
              filename: '',
              mediaType: '',
              metadata: undefined,
            },
          ],
          contextId: '',
          taskId: '',
          extensions: [],
          metadata: undefined,
          referenceTaskIds: [],
        },
        configuration: undefined,
        metadata: {},
      };

      const expectedExtensions = 'extension1,extension2';
      const serviceParameters = ServiceParameters.create(withA2AExtensions(expectedExtensions));
      const options: RequestOptions = {
        serviceParameters,
      };

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            result: {
              payload: {
                $case: 'msg',
                value: {
                  messageId: 'response-msg-1',
                  role: Role.ROLE_AGENT,
                  content: [{ part: { $case: 'text', value: 'Response' } }],
                },
              },
            },
            id: 1,
          }),
          {
            status: 200,
          }
        )
      );
      await transport.sendMessage(messageParams, options);
      const fetchArgs = mockFetch.mock.calls[0][1];
      const headers = fetchArgs.headers;
      expect((headers as any)[HTTP_EXTENSION_HEADER]).to.deep.equal(expectedExtensions);
    });
  });

  describe('TaskPushNotificationConfig', () => {
    it('createTaskPushNotificationConfig should send correct params and return config', async () => {
      const config: TaskPushNotificationConfig = {
        tenant: '',
        id: 'config1',
        taskId: 'task1',
        url: 'https://webhook.site',
        token: 'token123',
        authentication: undefined,
      };

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            result: config,
            id: 1,
          }),
          { status: 200 }
        )
      );

      const result = await transport.createTaskPushNotificationConfig(config);

      const fetchArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(fetchArgs.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfig/create');
      expect(body.params).toEqual({
        id: 'config1',
        taskId: 'task1',
        url: 'https://webhook.site',
        token: 'token123',
      });
      expect(result).toEqual(config);
    });

    it('getTaskPushNotificationConfig should return config', async () => {
      const params: GetTaskPushNotificationConfigRequest = {
        id: 'config1',
        taskId: 'task1',
        tenant: '',
      };

      const expectedConfig: TaskPushNotificationConfig = {
        tenant: '',
        id: 'config1',
        taskId: 'task1',
        url: 'https://webhook.site',
        token: 'token123',
        authentication: undefined,
      };

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            result: expectedConfig,
            id: 1,
          }),
          { status: 200 }
        )
      );

      const result = await transport.getTaskPushNotificationConfig(params);

      const fetchArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(fetchArgs.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfig/get');
      expect(body.params).toEqual({ id: 'config1', taskId: 'task1' });
      expect(result).toEqual(expectedConfig);
    });

    it('listTaskPushNotificationConfig should return list of configs', async () => {
      const params: ListTaskPushNotificationConfigsRequest = {
        taskId: 'task1',
        tenant: '',
        pageSize: 0,
        pageToken: '',
      };

      const expectedConfig: TaskPushNotificationConfig = {
        tenant: '',
        id: 'config1',
        taskId: 'task1',
        url: 'https://webhook.site',
        token: 'token123',
        authentication: undefined,
      };

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            result: {
              configs: [expectedConfig],
            },
            id: 1,
          }),
          { status: 200 }
        )
      );

      const result = await transport.listTaskPushNotificationConfig(params);

      const fetchArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(fetchArgs.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfig/list');
      expect(body.params).toEqual({ taskId: 'task1' });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expectedConfig);
    });
  });
});

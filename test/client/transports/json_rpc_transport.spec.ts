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

  describe('sendMessage', () => {
    it('should correctly add the extension headers', async () => {
      const messageParams: SendMessageRequest = {
        tenant: '',
        message: {
          messageId: 'test-msg-1',
          role: Role.ROLE_USER,
          content: [
            {
              part: {
                $case: 'text',
                value: 'Hello, agent!',
              },
            },
          ],
          contextId: 'ctx1',
          taskId: 'task1',
          extensions: [],
          metadata: {},
        },
        configuration: undefined,
        metadata: undefined,
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
                $case: 'message',
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
    it('setTaskPushNotificationConfig should send correct params and return config', async () => {
      const config: TaskPushNotificationConfig = {
        taskId: 'task1',
        id: 'config1',
        url: 'https://webhook.site',
        token: 'token123',
        authentication: undefined,
        tenant: '',
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

      const result = await transport.setTaskPushNotificationConfig(config);

      const fetchArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(fetchArgs.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfigs/create');
      expect(body.params).toEqual(config);
      expect(result).toEqual(config);
    });

    it('getTaskPushNotificationConfig should return config', async () => {
      const params: GetTaskPushNotificationConfigRequest = {
        taskId: 'task1',
        id: 'config1',
        tenant: '',
      };

      const expectedConfig: TaskPushNotificationConfig = {
        taskId: 'task1',
        id: 'config1',
        url: 'https://webhook.site',
        token: 'token123',
        authentication: undefined,
        tenant: '',
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
      expect(body.method).toBe('tasks/pushNotificationConfigs/get');
      expect(body.params).toEqual(params);
      expect(result).toEqual(expectedConfig);
    });

    it('listTaskPushNotificationConfigs should return list of configs', async () => {
      const params: ListTaskPushNotificationConfigsRequest = {
        taskId: 'task1',
        pageSize: 0,
        pageToken: '',
      };

      const expectedConfig: TaskPushNotificationConfig = {
        taskId: 'task1',
        id: 'config1',
        url: 'https://webhook.site',
        token: 'token123',
        authentication: undefined,
        tenant: '',
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

      const result = await transport.listTaskPushNotificationConfigs(params);

      const fetchArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(fetchArgs.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfigs/list');
      expect(body.params).toEqual(params);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expectedConfig);
    });
  });
});

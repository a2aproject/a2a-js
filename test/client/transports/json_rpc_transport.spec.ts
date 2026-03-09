import { JsonRpcTransport } from '../../../src/client/transports/json_rpc_transport.js';
import { describe, it, beforeEach, expect, vi, type Mock } from 'vitest';
import { Role } from '../../../src/index.js';
import {
  CreateTaskPushNotificationConfigRequest,
  GetTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigRequest,
  SendMessageRequest,
  TaskPushNotificationConfig,
} from '../../../src/types/pb/a2a_types.js';
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
        request: {
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
    it('setTaskPushNotificationConfig should send correct params and return config', async () => {
      const config: CreateTaskPushNotificationConfigRequest = {
        parent: 'tasks/task1',
        configId: 'config1',
        config: {
          name: 'tasks/task1/pushNotificationConfigs/config1',
          pushNotificationConfig: {
            id: 'config1',
            url: 'https://webhook.site',
            token: 'token123',
            authentication: undefined,
          },
        },
      };

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            result: {
              taskId: 'task1',
              pushNotificationConfig: config.config?.pushNotificationConfig,
            },
            id: 1,
          }),
          { status: 200 }
        )
      );

      const result = await transport.setTaskPushNotificationConfig(config);

      const fetchArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(fetchArgs.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfig/set');
      expect(body.params).toEqual({
        taskId: 'task1',
        pushNotificationConfig: config.config?.pushNotificationConfig,
      });
      expect(result).toEqual(config.config);
    });

    it('getTaskPushNotificationConfig should return config', async () => {
      const params: GetTaskPushNotificationConfigRequest = {
        name: 'tasks/task1/pushNotificationConfigs/config1',
      };

      const expectedConfig: TaskPushNotificationConfig = {
        name: 'tasks/task1/pushNotificationConfigs/config1',
        pushNotificationConfig: {
          id: 'config1',
          url: 'https://webhook.site',
          token: 'token123',
          authentication: undefined,
        },
      };

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            result: {
              taskId: 'task1',
              pushNotificationConfig: expectedConfig.pushNotificationConfig,
            },
            id: 1,
          }),
          { status: 200 }
        )
      );

      const result = await transport.getTaskPushNotificationConfig(params);

      const fetchArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(fetchArgs.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfig/get');
      expect(body.params).toEqual({ id: 'task1', pushNotificationConfigId: 'config1' });
      expect(result).toEqual(expectedConfig);
    });

    it('listTaskPushNotificationConfig should return list of configs', async () => {
      const params: ListTaskPushNotificationConfigRequest = {
        parent: 'tasks/task1',
        pageSize: 0,
        pageToken: '',
      };

      const expectedConfig: TaskPushNotificationConfig = {
        name: 'tasks/task1/pushNotificationConfigs/config1',
        pushNotificationConfig: {
          id: 'config1',
          url: 'https://webhook.site',
          token: 'token123',
          authentication: undefined,
        },
      };

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            result: [
              {
                taskId: 'task1',
                pushNotificationConfig: expectedConfig.pushNotificationConfig,
              },
            ],
            id: 1,
          }),
          { status: 200 }
        )
      );

      const result = await transport.listTaskPushNotificationConfig(params);

      const fetchArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(fetchArgs.body as string);
      expect(body.method).toBe('tasks/pushNotificationConfig/list');
      expect(body.params).toEqual({ id: 'task1' });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expectedConfig);
    });
  });
});

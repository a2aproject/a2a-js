import {
  JsonRpcTransport,
  JsonRpcTransportFactory,
} from '../../../src/client/transports/json_rpc_transport.js';
import { describe, it, beforeEach, expect, vi, type Mock } from 'vitest';
import { Role } from '../../../src/index.js';
import {
  type AgentCard,
  GetTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigsRequest,
  SendMessageRequest,
  TaskPushNotificationConfig,
} from '../../../src/types/pb/a2a.js';
import { RequestOptions } from '../../../src/client/multitransport-client.js';
import { HTTP_EXTENSION_HEADER } from '../../../src/constants.js';
import { ServiceParameters, withA2AExtensions } from '../../../src/client/service-parameters.js';
import { LegacyJsonRpcTransport } from '../../../src/compat/v0_3/client/transports/json_rpc_transport.js';

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
      expect(transport.protocolName).toBe('JSONRPC');
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
              message: {
                messageId: 'response-msg-1',
                role: Role.ROLE_AGENT,
                content: [{ part: { $case: 'text', value: 'Response' } }],
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
      expect(body.method).toBe('CreateTaskPushNotificationConfig');
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
      expect(body.method).toBe('GetTaskPushNotificationConfig');
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
      expect(body.method).toBe('ListTaskPushNotificationConfigs');
      expect(body.params).toEqual({ taskId: 'task1' });
      expect(result.configs).toHaveLength(1);
      expect(result.configs[0]).toEqual(expectedConfig);
    });
  });
});

describe('JsonRpcTransportFactory', () => {
  function baseAgentCard(): AgentCard {
    return {
      name: 'a',
      description: '',
      version: '1.0.0',
      supportedInterfaces: [],
      provider: undefined,
      capabilities: undefined,
      securitySchemes: {},
      securityRequirements: [],
      defaultInputModes: [],
      defaultOutputModes: [],
      skills: [],
      signatures: [],
    };
  }

  it("protocolName is 'JSONRPC'", () => {
    expect(new JsonRpcTransportFactory().protocolName).toBe('JSONRPC');
  });

  describe('legacyCompat enabled', () => {
    it('produces LegacyJsonRpcTransport when matched interface has protocolVersion 0.3', async () => {
      const card = baseAgentCard();
      card.supportedInterfaces = [
        {
          url: 'https://a.example/rpc',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '0.3',
        },
      ];
      const factory = new JsonRpcTransportFactory({ legacyCompat: { enabled: true } });
      const transport = await factory.create('https://a.example/rpc', card);
      expect(transport).toBeInstanceOf(LegacyJsonRpcTransport);
    });

    it('produces JsonRpcTransport when matched interface has protocolVersion 1.0', async () => {
      const card = baseAgentCard();
      card.supportedInterfaces = [
        {
          url: 'https://a.example/rpc',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '1.0',
        },
      ];
      const factory = new JsonRpcTransportFactory({ legacyCompat: { enabled: true } });
      const transport = await factory.create('https://a.example/rpc', card);
      expect(transport).toBeInstanceOf(JsonRpcTransport);
      expect(transport).not.toBeInstanceOf(LegacyJsonRpcTransport);
    });

    // TODO: It should default to v0.3 when protocolVersion is missing and legacyCompat is enabled
    // after https://github.com/a2aproject/a2a-js/issues/474
    it('produces JsonRpcTransport when matched interface has empty protocolVersion', async () => {
      const card = baseAgentCard();
      card.supportedInterfaces = [
        {
          url: 'https://a.example/rpc',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '',
        },
      ];
      const factory = new JsonRpcTransportFactory({ legacyCompat: { enabled: true } });
      const transport = await factory.create('https://a.example/rpc', card);
      expect(transport).toBeInstanceOf(JsonRpcTransport);
      expect(transport).not.toBeInstanceOf(LegacyJsonRpcTransport);
    });

    it('disambiguates by URL when multiple JSON-RPC interfaces are present', async () => {
      const card = baseAgentCard();
      card.supportedInterfaces = [
        {
          url: 'https://v1.example/rpc',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '1.0',
        },
        {
          url: 'https://v03.example/rpc',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '0.3',
        },
      ];
      const factory = new JsonRpcTransportFactory({ legacyCompat: { enabled: true } });

      const v03 = await factory.create('https://v03.example/rpc', card);
      expect(v03).toBeInstanceOf(LegacyJsonRpcTransport);

      const v1 = await factory.create('https://v1.example/rpc', card);
      expect(v1).toBeInstanceOf(JsonRpcTransport);
      expect(v1).not.toBeInstanceOf(LegacyJsonRpcTransport);
    });

    it('falls back to v1.0 JsonRpcTransport when no JSON-RPC interface is found', async () => {
      const card = baseAgentCard();
      card.supportedInterfaces = [
        {
          url: 'https://a.example/grpc',
          protocolBinding: 'GRPC',
          tenant: '',
          protocolVersion: '0.3',
        },
      ];
      const factory = new JsonRpcTransportFactory({ legacyCompat: { enabled: true } });
      const transport = await factory.create('https://a.example/rpc', card);
      expect(transport).toBeInstanceOf(JsonRpcTransport);
      expect(transport).not.toBeInstanceOf(LegacyJsonRpcTransport);
    });
  });

  describe('legacyCompat disabled (default)', () => {
    it('produces JsonRpcTransport for v0.3 interface when legacyCompat option is omitted', async () => {
      const card = baseAgentCard();
      card.supportedInterfaces = [
        {
          url: 'https://a.example/rpc',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '0.3',
        },
      ];
      const factory = new JsonRpcTransportFactory();
      const transport = await factory.create('https://a.example/rpc', card);
      expect(transport).toBeInstanceOf(JsonRpcTransport);
      expect(transport).not.toBeInstanceOf(LegacyJsonRpcTransport);
    });

    it('produces JsonRpcTransport for v0.3 interface when legacyCompat.enabled is false', async () => {
      const card = baseAgentCard();
      card.supportedInterfaces = [
        {
          url: 'https://a.example/rpc',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '0.3',
        },
      ];
      const factory = new JsonRpcTransportFactory({ legacyCompat: { enabled: false } });
      const transport = await factory.create('https://a.example/rpc', card);
      expect(transport).toBeInstanceOf(JsonRpcTransport);
      expect(transport).not.toBeInstanceOf(LegacyJsonRpcTransport);
    });
  });
});

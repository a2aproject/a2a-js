import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToProto } from '../../../../../src/compat/v0_3/types/converters/to_proto.js';
import * as types from '../../../../../src/compat/v0_3/types/types.js';
import * as proto from '../../../../../src/compat/v0_3/types/pb/a2a.js';
import * as idDecoding from '../../../../../src/compat/v0_3/types/converters/id_decoding.js';
import { A2AError } from '../../../../../src/compat/v0_3/server/error.js';

vi.mock('../../../../../src/compat/v0_3/types/converters/id_decoding.js', () => ({
  generatePushNotificationConfigName: vi.fn(),
  generateTaskName: vi.fn(),
}));

describe('ToProto', () => {
  beforeEach(() => {
    vi.mocked(idDecoding.generatePushNotificationConfigName).mockImplementation(
      (taskId, configId) => `tasks/${taskId}/pushNotificationConfigs/${configId}`
    );
    vi.mocked(idDecoding.generateTaskName).mockImplementation((id) => `tasks/${id}`);
  });

  it('should convert internal Task to proto Task', () => {
    const internalTask: types.Task = {
      id: 'task-123',
      kind: 'task',
      contextId: 'ctx-1',
      status: {
        state: 'completed',
        timestamp: '2023-01-01T00:00:00.000Z',
      },
      artifacts: [],
      history: [],
      metadata: { key: 'value' },
    };

    const result = ToProto.task(internalTask);

    expect(result).toEqual({
      id: 'task-123',
      contextId: 'ctx-1',
      status: {
        state: proto.TaskState.TASK_STATE_COMPLETED,
        timestamp: '2023-01-01T00:00:00.000Z',
        update: undefined,
      },
      artifacts: [],
      history: [],
      metadata: { key: 'value' },
    });
  });

  it('should convert internal Message to proto Message', () => {
    const internalMessage: types.Message = {
      kind: 'message',
      messageId: 'msg-1',
      parts: [{ kind: 'text', text: 'hello' }],
      contextId: 'ctx-1',
      taskId: 'task-1',
      role: 'user',
      metadata: { key: 'value' },
      extensions: ['ext1'],
    };

    const result = ToProto.message(internalMessage);

    expect(result).toEqual({
      messageId: 'msg-1',
      content: [{ part: { $case: 'text', value: 'hello' } }],
      contextId: 'ctx-1',
      taskId: 'task-1',
      role: proto.Role.ROLE_USER,
      metadata: { key: 'value' },
      extensions: ['ext1'],
    });
  });

  describe('taskState', () => {
    it.each([
      ['submitted', proto.TaskState.TASK_STATE_SUBMITTED],
      ['working', proto.TaskState.TASK_STATE_WORKING],
      ['input-required', proto.TaskState.TASK_STATE_INPUT_REQUIRED],
      ['rejected', proto.TaskState.TASK_STATE_REJECTED],
      ['auth-required', proto.TaskState.TASK_STATE_AUTH_REQUIRED],
      ['completed', proto.TaskState.TASK_STATE_COMPLETED],
      ['failed', proto.TaskState.TASK_STATE_FAILED],
      ['canceled', proto.TaskState.TASK_STATE_CANCELLED],
      ['unknown', proto.TaskState.TASK_STATE_UNSPECIFIED],
      ['invalid-state' as types.TaskState, proto.TaskState.UNRECOGNIZED],
    ])('should convert internal state "%s" to proto state %s', (internalState, expectedState) => {
      const result = ToProto.taskState(internalState as types.TaskState);
      expect(result).toBe(expectedState);
    });
  });

  describe('parts', () => {
    it('should convert a text part', () => {
      const part: types.Part = { kind: 'text', text: 'hello' };
      const result = ToProto.part(part);
      expect(result).toEqual({
        part: { $case: 'text', value: 'hello' },
      });
    });

    it('should convert a file part with URI', () => {
      const part: types.Part = {
        kind: 'file',
        file: { uri: 'file://path', mimeType: 'text/plain' },
      };
      const result = ToProto.part(part);
      expect(result).toEqual({
        part: {
          $case: 'file',
          value: {
            file: { $case: 'fileWithUri', value: 'file://path' },
            mimeType: 'text/plain',
          },
        },
      });
    });

    it('should convert a file part with bytes', () => {
      const base64Bytes = Buffer.from('file content').toString('base64');
      const part: types.Part = {
        kind: 'file',
        file: { bytes: base64Bytes, mimeType: 'application/octet-stream' },
      };
      const result = ToProto.part(part);
      expect(result).toEqual({
        part: {
          $case: 'file',
          value: {
            file: { $case: 'fileWithBytes', value: Buffer.from('file content') },
            mimeType: 'application/octet-stream',
          },
        },
      });
    });

    it('should throw for an invalid file part', () => {
      const part: types.Part = {
        kind: 'file',
        file: {} as any,
      };
      expect(() => ToProto.part(part)).toThrow(new A2AError(-32603, 'Invalid file part'));
    });

    it('should convert a data part', () => {
      const data = { foo: 'bar' };
      const part: types.Part = { kind: 'data', data };
      const result = ToProto.part(part);
      expect(result).toEqual({
        part: { $case: 'data', value: { data } },
      });
    });

    it('should throw for an unknown part type', () => {
      const part: types.Part = { kind: 'unknown' } as any;
      expect(() => ToProto.part(part)).toThrow(new A2AError(-32603, 'Invalid part type'));
    });
  });

  it('should convert internal Artifact to proto Artifact', () => {
    const internalArtifact: types.Artifact = {
      artifactId: 'art-1',
      name: 'My Artifact',
      description: 'A test artifact',
      parts: [{ kind: 'text', text: 'artifact content' }],
      metadata: { key: 'value' },
      extensions: ['ext1'],
    };

    const result = ToProto.artifact(internalArtifact);

    expect(result).toEqual({
      artifactId: 'art-1',
      name: 'My Artifact',
      description: 'A test artifact',
      parts: [{ part: { $case: 'text', value: 'artifact content' } }],
      metadata: { key: 'value' },
      extensions: ['ext1'],
    });
  });

  describe('messageSendResult', () => {
    it('should convert a message result', () => {
      const message: types.Message = {
        kind: 'message',
        messageId: 'msg-1',
        parts: [],
        role: 'agent',
      };
      const result = ToProto.messageSendResult(message);
      expect(result.payload?.$case).toBe('msg');
      expect((result.payload as any).value.messageId).toBe('msg-1');
    });

    it('should convert a task result', () => {
      const task: types.Task = {
        kind: 'task',
        id: 'task-123',
        contextId: 'ctx-1',
        status: { state: 'submitted' },
        history: [],
        artifacts: [],
      };
      const result = ToProto.messageSendResult(task);
      expect(result.payload?.$case).toBe('task');
      expect((result.payload as any).value.id).toBe('task-123');
    });

    it('should return undefined for invalid kind', () => {
      const invalid = { kind: 'invalid' } as any;
      const result = ToProto.messageSendResult(invalid);
      expect(result).toBeUndefined();
    });
  });

  describe('messageStreamResult', () => {
    it('should convert a message event', () => {
      const event: types.Message = {
        kind: 'message',
        messageId: 'msg-1',
        parts: [],
        role: 'agent',
      };
      const result = ToProto.messageStreamResult(event);
      expect(result.payload?.$case).toBe('msg');
    });

    it('should convert a task event', () => {
      const event: types.Task = {
        kind: 'task',
        id: 'task-123',
        contextId: 'ctx-1',
        status: { state: 'submitted' },
        history: [],
        artifacts: [],
      };
      const result = ToProto.messageStreamResult(event);
      expect(result.payload?.$case).toBe('task');
    });

    it('should convert a status-update event', () => {
      const event: types.TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 'task-123',
        status: { state: 'working' },
        contextId: 'ctx-1',
        metadata: {},
        final: false,
      };
      const result = ToProto.messageStreamResult(event);
      expect(result.payload?.$case).toBe('statusUpdate');
    });

    it('should convert an artifact-update event', () => {
      const event: types.TaskArtifactUpdateEvent = {
        kind: 'artifact-update',
        taskId: 'task-123',
        artifact: { artifactId: 'art-1', parts: [] },
        contextId: 'ctx-1',
        metadata: {},
      };
      const result = ToProto.messageStreamResult(event);
      expect(result.payload?.$case).toBe('artifactUpdate');
    });

    it('should throw for an invalid event type', () => {
      const event = { kind: 'invalid' } as any;
      expect(() => ToProto.messageStreamResult(event)).toThrow(
        new A2AError(-32603, 'Invalid event type')
      );
    });
  });

  it('should convert PushNotificationAuthenticationInfo', () => {
    const authInfo: types.PushNotificationAuthenticationInfo = {
      schemes: ['bearer'],
      credentials: 'my-token',
    };
    const result = ToProto.pushNotificationAuthenticationInfo(authInfo);
    expect(result).toEqual({
      schemes: ['bearer'],
      credentials: 'my-token',
    });
  });

  it('should convert PushNotificationConfig', () => {
    const config: types.PushNotificationConfig = {
      id: 'pnc-456',
      url: 'https://example.com/notify',
      token: 'push-token',
      authentication: {
        schemes: ['bearer'],
        credentials: 'my-token',
      },
    };
    const result = ToProto.pushNotificationConfig(config);
    expect(result).toEqual({
      id: 'pnc-456',
      url: 'https://example.com/notify',
      token: 'push-token',
      authentication: {
        schemes: ['bearer'],
        credentials: 'my-token',
      },
    });
  });

  it('should convert TaskPushNotificationConfig', () => {
    const config: types.TaskPushNotificationConfig = {
      taskId: 'task-123',
      pushNotificationConfig: {
        id: 'pnc-456',
        url: 'https://example.com/notify',
      },
    };
    const result = ToProto.taskPushNotificationConfig(config);
    expect(idDecoding.generatePushNotificationConfigName).toHaveBeenCalledWith(
      'task-123',
      'pnc-456'
    );
    expect(result).toEqual({
      name: 'tasks/task-123/pushNotificationConfigs/pnc-456',
      pushNotificationConfig: {
        id: 'pnc-456',
        url: 'https://example.com/notify',
        token: '',
        authentication: undefined,
      },
    });
  });

  it('should convert a list of TaskPushNotificationConfigs', () => {
    const configs: types.TaskPushNotificationConfig[] = [
      {
        taskId: 'task-123',
        pushNotificationConfig: { id: 'pnc-456', url: 'https://example.com/notify' },
      },
    ];
    const result = ToProto.listTaskPushNotificationConfig(configs);
    expect(result.configs.length).toBe(1);
    expect(result.nextPageToken).toBe('');
    expect(result.configs[0].name).toBe('tasks/task-123/pushNotificationConfigs/pnc-456');
  });

  it('should convert getTaskPushNotificationConfigParams', () => {
    const res = ToProto.getTaskPushNotificationConfigParams({
      id: 'task-1',
      pushNotificationConfigId: 'pnc-1',
    });
    expect(res.name).toBe('tasks/task-1/pushNotificationConfigs/pnc-1');
  });

  it('should convert listTaskPushNotificationConfigParams', () => {
    const res = ToProto.listTaskPushNotificationConfigParams({ id: 'task-1' });
    expect(res.parent).toBe('tasks/task-1');
  });

  it('should convert deleteTaskPushNotificationConfigParams', () => {
    const res = ToProto.deleteTaskPushNotificationConfigParams({
      id: 'task-1',
      pushNotificationConfigId: 'pnc-1',
    });
    expect(res.name).toBe('tasks/task-1/pushNotificationConfigs/pnc-1');
  });

  it('should convert taskPushNotificationConfigCreate', () => {
    const res = ToProto.taskPushNotificationConfigCreate({
      taskId: 'task-1',
      pushNotificationConfig: { id: 'pnc-1', url: 'http://url' },
    });
    expect(res.config?.pushNotificationConfig?.id).toBe('pnc-1');
  });

  describe('securityScheme', () => {
    it('should convert apiKey scheme', () => {
      const scheme: types.SecurityScheme = {
        type: 'apiKey',
        name: 'X-API-KEY',
        in: 'header',
        description: 'API Key auth',
      };
      const result = ToProto.securityScheme(scheme);
      expect(result.scheme?.$case).toBe('apiKeySecurityScheme');
    });

    it('should convert http scheme', () => {
      const scheme: types.SecurityScheme = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      };
      const result = ToProto.securityScheme(scheme);
      expect(result.scheme?.$case).toBe('httpAuthSecurityScheme');
    });

    it('should convert mutualTLS, oauth2, openIdConnect schemes', () => {
      const s3: types.SecurityScheme = { type: 'mutualTLS' };
      const s4: types.SecurityScheme = {
        type: 'oauth2',
        flows: { implicit: { authorizationUrl: 'url', scopes: {} } },
      };
      const s5: types.SecurityScheme = { type: 'openIdConnect', openIdConnectUrl: 'url' };
      expect(ToProto.securityScheme(s3).scheme?.$case).toBe('mtlsSecurityScheme');
      expect(ToProto.securityScheme(s4).scheme?.$case).toBe('oauth2SecurityScheme');
      expect(ToProto.securityScheme(s5).scheme?.$case).toBe('openIdConnectSecurityScheme');
    });

    it('should throw on unsupported security scheme', () => {
      const scheme: types.SecurityScheme = { type: 'unsupported' } as any;
      expect(() => ToProto.securityScheme(scheme)).toThrow(
        A2AError.internalError('Unsupported security scheme type')
      );
    });
  });

  describe('oauthFlows', () => {
    it('should convert implicit flow', () => {
      const flows: types.OAuthFlows = {
        implicit: { authorizationUrl: 'url', scopes: { s1: '' } },
      };
      const result = ToProto.oauthFlows(flows);
      expect(result.flow?.$case).toBe('implicit');
    });

    it('should convert password, clientCredentials, authorizationCode flows', () => {
      const f1: types.OAuthFlows = { password: { tokenUrl: 't', scopes: {} } };
      const f2: types.OAuthFlows = { clientCredentials: { tokenUrl: 't', scopes: {} } };
      const f3: types.OAuthFlows = {
        authorizationCode: { authorizationUrl: 'a', tokenUrl: 't', scopes: {} },
      };
      expect(ToProto.oauthFlows(f1).flow?.$case).toBe('password');
      expect(ToProto.oauthFlows(f2).flow?.$case).toBe('clientCredentials');
      expect(ToProto.oauthFlows(f3).flow?.$case).toBe('authorizationCode');
    });

    it('should throw on unsupported flow', () => {
      const flows: types.OAuthFlows = {};
      expect(() => ToProto.oauthFlows(flows)).toThrow(
        A2AError.internalError('Unsupported OAuth flows')
      );
    });
  });

  describe('agentCard', () => {
    it('should convert agentCard with all optional fields', () => {
      const card: types.AgentCard = {
        name: 'n',
        description: 'd',
        documentationUrl: 'url',
        url: 'url',
        version: '1',
        protocolVersion: '1',
        preferredTransport: 'http',
        additionalInterfaces: [{ transport: 'http', url: 'url' }],
        capabilities: {
          streaming: true,
          pushNotifications: true,
          extensions: [{ uri: 'ext', description: 'd', required: true, params: {} }],
        },
        provider: { organization: 'org', url: 'url' },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        security: [{ s1: [] }],
        securitySchemes: {
          s1: { type: 'apiKey', name: 'k', in: 'header', description: 'd' },
          s2: { type: 'http', scheme: 'bearer', bearerFormat: 'jwt' },
          s3: { type: 'mutualTLS' },
          s4: {
            type: 'oauth2',
            flows: { implicit: { authorizationUrl: 'url', scopes: {} } },
            oauth2MetadataUrl: 'url',
          },
          s5: { type: 'openIdConnect', openIdConnectUrl: 'url' },
        },
        skills: [
          {
            id: 's1',
            name: 'sk',
            description: 'd',
            tags: [],
            examples: [],
            inputModes: [],
            outputModes: [],
            security: [],
          },
        ],
        signatures: [{ protected: 'p', signature: 's', header: {} }],
        supportsAuthenticatedExtendedCard: true,
      };
      const res = ToProto.agentCard(card);
      expect(res.name).toBe('n');
      expect(res.capabilities?.streaming).toBe(true);
      expect(res.provider?.organization).toBe('org');
      expect(Object.keys(res.securitySchemes).length).toBe(5);
    });

    it('should convert agentCard with minimal fields', () => {
      const card: types.AgentCard = {
        name: 'n',
        description: 'd',
        documentationUrl: 'url',
        url: 'url',
        version: '1',
        protocolVersion: '1',
        preferredTransport: 'http',
        additionalInterfaces: [],
        capabilities: undefined,
        provider: undefined,
        defaultInputModes: [],
        defaultOutputModes: [],
        security: [],
        securitySchemes: {},
        skills: [],
        signatures: [],
        supportsAuthenticatedExtendedCard: false,
      };
      const res = ToProto.agentCard(card);
      expect(res.name).toBe('n');
    });
  });

  describe('taskEvents', () => {
    it('should convert taskStatusUpdateEvent', () => {
      const res = ToProto.taskStatusUpdateEvent({
        kind: 'status-update',
        taskId: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'working' },
        metadata: {},
        final: false,
      });
      expect(res.taskId).toBe('task-1');
    });

    it('should convert taskArtifactUpdateEvent', () => {
      const res = ToProto.taskArtifactUpdateEvent({
        kind: 'artifact-update',
        taskId: 'task-1',
        contextId: 'ctx-1',
        artifact: { artifactId: 'art-1', parts: [] },
        metadata: {},
      });
      expect(res.taskId).toBe('task-1');
    });
  });

  describe('role', () => {
    it('should throw on invalid role', () => {
      expect(() => ToProto.role('invalid' as any)).toThrow(A2AError.internalError('Invalid role'));
    });
  });

  describe('messageSendParams', () => {
    it('should convert messageSendParams', () => {
      const res = ToProto.messageSendParams({
        message: { kind: 'message', messageId: '1', parts: [], role: 'user' },
        configuration: { blocking: true, acceptedOutputModes: [] },
        metadata: {},
      });
      expect(res.request?.messageId).toBe('1');
    });

    it('should convert configuration with pushNotificationConfig', () => {
      const res = ToProto.configuration({
        blocking: true,
        acceptedOutputModes: [],
        pushNotificationConfig: { id: 'pnc-1', url: 'http://url' },
      });
      expect(res.pushNotification?.id).toBe('pnc-1');
    });
  });

  describe('taskRequests', () => {
    it('should convert taskQueryParams', () => {
      const res = ToProto.taskQueryParams({ id: 'task-1', historyLength: 5 });
      expect(res.name).toBe('tasks/task-1');
      expect(res.historyLength).toBe(5);
    });

    it('should convert cancelTaskRequest', () => {
      const res = ToProto.cancelTaskRequest({ id: 'task-1' });
      expect(res.name).toBe('tasks/task-1');
    });

    it('should convert taskIdParams', () => {
      const res = ToProto.taskIdParams({ id: 'task-1' });
      expect(res.name).toBe('tasks/task-1');
    });
  });

  describe('getAgentCardRequest', () => {
    it('should convert getAgentCardRequest', () => {
      const res = ToProto.getAgentCardRequest();
      expect(res).toEqual({});
    });
  });
});

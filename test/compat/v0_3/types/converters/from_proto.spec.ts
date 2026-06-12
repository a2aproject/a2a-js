import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FromProto } from '../../../../../src/compat/v0_3/types/converters/from_proto.js';
import * as proto from '../../../../../src/compat/v0_3/types/pb/a2a.js';
import * as idDecoding from '../../../../../src/compat/v0_3/types/converters/id_decoding.js';
import { A2AError } from '../../../../../src/compat/v0_3/server/error.js';

vi.mock('../../../../../src/compat/v0_3/types/converters/id_decoding.js', () => ({
  extractTaskId: vi.fn(),
  extractTaskAndPushNotificationConfigId: vi.fn(),
}));

describe('FromProto', () => {
  beforeEach(() => {
    vi.mocked(idDecoding.extractTaskId).mockReturnValue('task-123');
    vi.mocked(idDecoding.extractTaskAndPushNotificationConfigId).mockReturnValue({
      taskId: 'task-123',
      configId: 'pnc-456',
    });
  });

  it('should convert GetTaskRequest to taskQueryParams', () => {
    const request: proto.GetTaskRequest = {
      name: 'tasks/task-123',
      historyLength: 10,
    };
    const result = FromProto.taskQueryParams(request);
    expect(idDecoding.extractTaskId).toHaveBeenCalledWith('tasks/task-123');
    expect(result).toEqual({
      id: 'task-123',
      historyLength: 10,
    });
  });

  it('should convert CancelTaskRequest to taskIdParams', () => {
    const request: proto.CancelTaskRequest = {
      name: 'tasks/task-123',
    };
    const result = FromProto.taskIdParams(request);
    expect(idDecoding.extractTaskId).toHaveBeenCalledWith('tasks/task-123');
    expect(result).toEqual({
      id: 'task-123',
    });
  });

  it('should convert GetTaskPushNotificationConfigRequest to params', () => {
    const request: proto.GetTaskPushNotificationConfigRequest = {
      name: 'tasks/task-123/pushNotificationConfigs/pnc-456',
    };
    const result = FromProto.getTaskPushNotificationConfigParams(request);
    expect(idDecoding.extractTaskAndPushNotificationConfigId).toHaveBeenCalledWith(request.name);
    expect(result).toEqual({
      id: 'task-123',
      pushNotificationConfigId: 'pnc-456',
    });
  });

  it('should convert ListTaskPushNotificationConfigRequest to params', () => {
    const request: proto.ListTaskPushNotificationConfigRequest = {
      parent: 'tasks/task-123',
      pageToken: '',
      pageSize: 0,
    };
    const result = FromProto.listTaskPushNotificationConfigParams(request);
    expect(idDecoding.extractTaskId).toHaveBeenCalledWith(request.parent);
    expect(result).toEqual({
      id: 'task-123',
    });
  });

  it('should convert CreateTaskPushNotificationConfigRequest to params', () => {
    const request: proto.TaskPushNotificationConfig = {
      name: 'tasks/task-123/pushNotificationConfigs/pnc-456',
      pushNotificationConfig: {
        id: 'pnc-456',
        url: 'http://example.com',
        token: 'token-abc',
        authentication: undefined,
      },
    };
    const result = FromProto.taskPushNotificationConfig(request);
    expect(idDecoding.extractTaskId).toHaveBeenCalledWith(request.name);
    expect(result).toEqual({
      taskId: 'task-123',
      pushNotificationConfig: {
        id: 'pnc-456',
        url: 'http://example.com',
        token: 'token-abc',
        authentication: undefined,
      },
    });
  });

  it('should convert DeleteTaskPushNotificationConfigRequest to params', () => {
    const request: proto.DeleteTaskPushNotificationConfigRequest = {
      name: 'tasks/task-123/pushNotificationConfigs/pnc-456',
    };
    const result = FromProto.deleteTaskPushNotificationConfigParams(request);
    expect(idDecoding.extractTaskAndPushNotificationConfigId).toHaveBeenCalledWith(request.name);
    expect(result).toEqual({
      id: 'task-123',
      pushNotificationConfigId: 'pnc-456',
    });
  });

  it('should convert proto Message to internal Message', () => {
    const protoMessage: proto.Message = {
      messageId: 'msg-1',
      content: [],
      contextId: 'ctx-1',
      taskId: 'task-1',
      role: proto.Role.ROLE_AGENT,
      metadata: { key: 'value' },
      extensions: ['ext1'],
    };
    const result = FromProto.message(protoMessage);
    expect(result).toEqual({
      kind: 'message',
      messageId: 'msg-1',
      parts: [],
      contextId: 'ctx-1',
      taskId: 'task-1',
      role: 'agent',
      metadata: { key: 'value' },
      extensions: ['ext1'],
    });
  });

  it('should convert proto SendMessageConfiguration to internal type', () => {
    const protoConfig: proto.SendMessageConfiguration = {
      blocking: true,
      acceptedOutputModes: ['text/plain'],
      pushNotification: {
        id: 'pnc-1',
        url: 'http://notify.me',
        token: 'token',
        authentication: undefined,
      },
      historyLength: 0,
    };
    const result = FromProto.messageSendConfiguration(protoConfig);
    expect(result).toEqual({
      blocking: true,
      acceptedOutputModes: ['text/plain'],
      pushNotificationConfig: {
        id: 'pnc-1',
        url: 'http://notify.me',
        token: 'token',
        authentication: undefined,
      },
    });
  });

  it('should convert proto AuthenticationInfo to internal type', () => {
    const authInfo: proto.AuthenticationInfo = {
      schemes: ['bearer'],
      credentials: 'bearer-token',
    };
    const result = FromProto.pushNotificationAuthenticationInfo(authInfo);
    expect(result).toEqual({
      schemes: ['bearer'],
      credentials: 'bearer-token',
    });
  });

  describe('parts', () => {
    it('should convert a text part', () => {
      const part: proto.Part = { part: { $case: 'text', value: 'hello' } };
      const result = FromProto.part(part);
      expect(result).toEqual({ kind: 'text', text: 'hello' });
    });

    it('should convert a file part with URI', () => {
      const part: proto.Part = {
        part: {
          $case: 'file',
          value: {
            file: { $case: 'fileWithUri', value: 'file://path/to/file' },
            mimeType: 'text/plain',
          },
        },
      };
      const result = FromProto.part(part);
      expect(result).toEqual({
        kind: 'file',
        file: { mimeType: 'text/plain', uri: 'file://path/to/file' },
      });
    });

    it('should convert a file part with bytes (v0.3 wire convention)', () => {
      // Per v0.3 SDK interop: `file_with_bytes` over gRPC carries the
      // base64 string's UTF-8 bytes, not raw decoded bytes. Decoding
      // the buffer as UTF-8 yields back the base64 string the caller
      // originally produced — matching what a2a-go v0.3's
      // `string([]byte)` cast and a2a-python v0.3's str(bytes, 'utf-8')
      // produce. This is the de-facto wire format across the v0.3
      // reference SDKs, even though the proto file declares the field
      // as `bytes`.
      const base64Bytes = Buffer.from('file content').toString('base64');
      const wireBytes = Buffer.from(base64Bytes, 'utf8');
      const part: proto.Part = {
        part: {
          $case: 'file',
          value: { file: { $case: 'fileWithBytes', value: wireBytes }, mimeType: 'text/plain' },
        },
      };
      const result = FromProto.part(part);
      expect(result).toEqual({
        kind: 'file',
        file: { bytes: base64Bytes, mimeType: 'text/plain' },
      });
    });

    it('should throw for invalid file part', () => {
      const part: proto.Part = {
        part: {
          $case: 'file',
          value: {
            file: { $case: 'wrong format', value: 'invalid bytes' } as any,
            mimeType: 'text/plain',
          }, // Invalid state
        },
      };
      expect(() => FromProto.part(part)).toThrow(new A2AError(-32602, 'Invalid file part type'));
    });

    it('should convert a data part', () => {
      const data = { foo: 'bar' };
      const part: proto.Part = { part: { $case: 'data', value: { data } } };
      const result = FromProto.part(part);
      expect(result).toEqual({ kind: 'data', data });
    });

    it('should throw for an unknown part type', () => {
      const part: proto.Part = { part: { $case: 'invalid', value: undefined } as any }; // Invalid state
      expect(() => FromProto.part(part)).toThrow(new A2AError(-32602, 'Invalid part type'));
    });
  });

  it('should convert SendMessageRequest to messageSendParams', () => {
    const request: proto.SendMessageRequest = {
      request: {
        messageId: 'msg-1',
        content: [],
        contextId: 'ctx-1',
        taskId: 'task-1',
        role: proto.Role.ROLE_USER,
        metadata: {},
        extensions: [],
      },
      configuration: {
        blocking: false,
        acceptedOutputModes: [],
        pushNotification: undefined,
        historyLength: 0,
      },
      metadata: { client: 'test' },
    };

    const result = FromProto.messageSendParams(request);

    expect(result).toEqual({
      message: expect.any(Object),
      configuration: expect.any(Object),
      metadata: { client: 'test' },
    });
    expect(result.message.role).toBe('user');
  });

  describe('sendMessageResult', () => {
    it('should convert sendMessageResult with task', () => {
      const response: proto.SendMessageResponse = {
        payload: {
          $case: 'task',
          value: {
            id: 'task-123',
            contextId: 'ctx-1',
            status: {
              state: proto.TaskState.TASK_STATE_SUBMITTED,
              timestamp: '2023',
              update: undefined,
            },
            artifacts: [],
            history: [],
            metadata: {},
          },
        },
      };
      const result = FromProto.sendMessageResult(response);
      expect(result.kind).toBe('task');
    });

    it('should convert sendMessageResult with msg', () => {
      const response: proto.SendMessageResponse = {
        payload: {
          $case: 'msg',
          value: {
            messageId: 'msg-1',
            content: [],
            contextId: 'ctx-1',
            taskId: 'task-1',
            role: proto.Role.ROLE_AGENT,
            metadata: {},
            extensions: [],
          },
        },
      };
      const result = FromProto.sendMessageResult(response);
      expect(result.kind).toBe('message');
    });

    it('should throw on invalid sendMessageResult', () => {
      const response: proto.SendMessageResponse = {
        payload: undefined,
      };
      expect(() => FromProto.sendMessageResult(response)).toThrow(
        new A2AError(-32602, 'Invalid SendMessageResponse: missing result')
      );
    });
  });

  describe('task', () => {
    it('should convert task with history and artifacts', () => {
      const protoTask: proto.Task = {
        id: 'task-123',
        contextId: 'ctx-1',
        status: {
          state: proto.TaskState.TASK_STATE_COMPLETED,
          timestamp: '2023',
          update: undefined,
        },
        artifacts: [
          {
            artifactId: 'art-1',
            name: 'name',
            description: 'desc',
            parts: [{ part: { $case: 'text', value: 'foo' } }],
            metadata: {},
            extensions: [],
          },
        ],
        history: [
          {
            messageId: 'msg-1',
            content: [{ part: { $case: 'text', value: 'bar' } }],
            contextId: 'ctx-1',
            taskId: 'task-123',
            role: proto.Role.ROLE_USER,
            metadata: {},
            extensions: [],
          },
        ],
        metadata: { k: 'v' },
      };
      const result = FromProto.task(protoTask);
      expect(result.id).toBe('task-123');
      expect(result.artifacts?.length).toBe(1);
      expect(result.history?.length).toBe(1);
    });
  });

  describe('taskState', () => {
    it('should convert all task states', () => {
      expect(FromProto.taskState(proto.TaskState.TASK_STATE_SUBMITTED)).toBe('submitted');
      expect(FromProto.taskState(proto.TaskState.TASK_STATE_WORKING)).toBe('working');
      expect(FromProto.taskState(proto.TaskState.TASK_STATE_INPUT_REQUIRED)).toBe('input-required');
      expect(FromProto.taskState(proto.TaskState.TASK_STATE_COMPLETED)).toBe('completed');
      expect(FromProto.taskState(proto.TaskState.TASK_STATE_CANCELLED)).toBe('canceled');
      expect(FromProto.taskState(proto.TaskState.TASK_STATE_FAILED)).toBe('failed');
      expect(FromProto.taskState(proto.TaskState.TASK_STATE_REJECTED)).toBe('rejected');
      expect(FromProto.taskState(proto.TaskState.TASK_STATE_AUTH_REQUIRED)).toBe('auth-required');
      expect(FromProto.taskState(proto.TaskState.TASK_STATE_UNSPECIFIED)).toBe('unknown');
      expect(() => FromProto.taskState(proto.TaskState.UNRECOGNIZED)).toThrow();
    });
  });

  it('should convert TaskPushNotificationConfig', () => {
    const req: proto.TaskPushNotificationConfig = {
      name: 'tasks/task-123',
      pushNotificationConfig: {
        id: 'pnc-1',
        url: 'http://url',
        token: 't',
        authentication: undefined,
      },
    };
    const res = FromProto.taskPushNotificationConfig(req);
    expect(res.taskId).toBe('task-123');
  });

  it('should convert ListTaskPushNotificationConfigResponse', () => {
    const req: proto.ListTaskPushNotificationConfigResponse = {
      configs: [
        {
          name: 'tasks/task-123',
          pushNotificationConfig: {
            id: 'pnc-1',
            url: 'http://url',
            token: 't',
            authentication: undefined,
          },
        },
      ],
      nextPageToken: '',
    };
    const res = FromProto.listTaskPushNotificationConfig(req);
    expect(res.length).toBe(1);
  });

  describe('agentCard', () => {
    it('should convert agentCard with all optional fields', () => {
      const card: proto.AgentCard = {
        additionalInterfaces: [{ transport: 'http', url: 'http://url' }],
        capabilities: {
          extensions: [{ uri: 'ext', description: 'desc', required: true, params: {} }],
          pushNotifications: true,
          streaming: true,
        },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        description: 'desc',
        documentationUrl: 'http://docs',
        name: 'name',
        preferredTransport: 'http',
        provider: { organization: 'org', url: 'http://org' },
        protocolVersion: '1.0',
        security: [{ schemes: { k: { list: ['v'] } } }],
        securitySchemes: {
          s1: {
            scheme: {
              $case: 'apiKeySecurityScheme',
              value: { name: 'k', location: 'header', description: 'd' },
            },
          },
          s2: {
            scheme: {
              $case: 'httpAuthSecurityScheme',
              value: { scheme: 'bearer', bearerFormat: 'jwt', description: 'd' },
            },
          },
          s3: {
            scheme: {
              $case: 'mtlsSecurityScheme',
              value: { description: 'd' },
            },
          },
          s4: {
            scheme: {
              $case: 'oauth2SecurityScheme',
              value: {
                description: 'd',
                flows: {
                  flow: {
                    $case: 'implicit',
                    value: { authorizationUrl: 'url', scopes: {}, refreshUrl: 'r' },
                  },
                },
                oauth2MetadataUrl: 'url',
              },
            },
          },
          s5: {
            scheme: {
              $case: 'openIdConnectSecurityScheme',
              value: { description: 'd', openIdConnectUrl: 'url' },
            },
          },
        },
        skills: [
          {
            id: 's1',
            name: 'skill',
            description: 'desc',
            tags: [],
            examples: [],
            inputModes: [],
            outputModes: [],
            security: [],
          },
        ],
        signatures: [{ protected: 'p', signature: 's', header: {} }],
        supportsAuthenticatedExtendedCard: true,
        url: 'http://card',
        version: '1.0',
      };
      const res = FromProto.agentCard(card);
      expect(res.name).toBe('name');
      expect(res.capabilities?.streaming).toBe(true);
      expect(res.provider?.organization).toBe('org');
      expect(Object.keys(res.securitySchemes ?? {}).length).toBe(5);
    });

    it('should convert agentCard with minimal fields', () => {
      const card: proto.AgentCard = {
        additionalInterfaces: [],
        capabilities: undefined,
        defaultInputModes: [],
        defaultOutputModes: [],
        description: 'desc',
        documentationUrl: '',
        name: 'name',
        preferredTransport: '',
        provider: undefined,
        protocolVersion: '1',
        security: [],
        securitySchemes: {},
        skills: [],
        signatures: [],
        supportsAuthenticatedExtendedCard: false,
        url: 'http://url',
        version: '1',
      };
      const res = FromProto.agentCard(card);
      expect(res.name).toBe('name');
    });

    it('should throw on unsupported security scheme in agentCard', () => {
      const scheme = { scheme: { $case: 'invalid', value: {} } as any };
      expect(() => FromProto.securityScheme(scheme)).toThrow();
    });
  });

  describe('oauthFlows', () => {
    it('should convert all oauthFlows cases', () => {
      const f1: proto.OAuthFlows = {
        flow: { $case: 'password', value: { tokenUrl: 't', scopes: {}, refreshUrl: 'r' } },
      };
      const f2: proto.OAuthFlows = {
        flow: {
          $case: 'authorizationCode',
          value: { authorizationUrl: 'a', tokenUrl: 't', scopes: {}, refreshUrl: 'r' },
        },
      };
      const f3: proto.OAuthFlows = {
        flow: { $case: 'clientCredentials', value: { tokenUrl: 't', scopes: {}, refreshUrl: 'r' } },
      };
      expect(FromProto.oauthFlows(f1).password?.tokenUrl).toBe('t');
      expect(FromProto.oauthFlows(f2).authorizationCode?.authorizationUrl).toBe('a');
      expect(FromProto.oauthFlows(f3).clientCredentials?.tokenUrl).toBe('t');
      expect(() =>
        FromProto.oauthFlows({ flow: { $case: 'invalid', value: {} } as any })
      ).toThrow();
    });
  });

  describe('taskEvents', () => {
    it('should convert taskStatusUpdateEvent', () => {
      const event: proto.TaskStatusUpdateEvent = {
        taskId: 'task-1',
        status: { state: proto.TaskState.TASK_STATE_WORKING, timestamp: '1', update: undefined },
        contextId: 'ctx-1',
        metadata: {},
        final: false,
      };
      const res = FromProto.taskStatusUpdateEvent(event);
      expect(res.kind).toBe('status-update');
    });

    it('should convert taskArtifactUpdateEvent', () => {
      const event: proto.TaskArtifactUpdateEvent = {
        taskId: 'task-1',
        artifact: {
          artifactId: 'art-1',
          name: 'n',
          description: 'd',
          parts: [],
          metadata: {},
          extensions: [],
        },
        contextId: 'ctx-1',
        metadata: {},
        lastChunk: false,
        append: false,
      };
      const res = FromProto.taskArtifactUpdateEvent(event);
      expect(res.kind).toBe('artifact-update');
    });
  });

  describe('messageStreamResult', () => {
    it('should convert messageStreamResult for all cases', () => {
      const e1: proto.StreamResponse = {
        payload: {
          $case: 'msg',
          value: {
            messageId: '1',
            content: [],
            contextId: 'ctx-1',
            taskId: 'task-1',
            role: proto.Role.ROLE_USER,
            metadata: {},
            extensions: [],
          },
        },
      };
      const e2: proto.StreamResponse = {
        payload: {
          $case: 'task',
          value: {
            id: '1',
            contextId: 'ctx-1',
            status: {
              state: proto.TaskState.TASK_STATE_WORKING,
              timestamp: '1',
              update: undefined,
            },
            artifacts: [],
            history: [],
            metadata: {},
          },
        },
      };
      const e3: proto.StreamResponse = {
        payload: {
          $case: 'statusUpdate',
          value: {
            taskId: '1',
            contextId: 'ctx-1',
            status: {
              state: proto.TaskState.TASK_STATE_WORKING,
              timestamp: '1',
              update: undefined,
            },
            metadata: {},
            final: false,
          },
        },
      };
      const e4: proto.StreamResponse = {
        payload: {
          $case: 'artifactUpdate',
          value: {
            taskId: '1',
            contextId: 'ctx-1',
            artifact: {
              artifactId: '1',
              name: 'n',
              description: 'd',
              parts: [],
              metadata: {},
              extensions: [],
            },
            metadata: {},
            lastChunk: false,
            append: false,
          },
        },
      };
      expect(FromProto.messageStreamResult(e1).kind).toBe('message');
      expect(FromProto.messageStreamResult(e2).kind).toBe('task');
      expect(FromProto.messageStreamResult(e3).kind).toBe('status-update');
      expect(FromProto.messageStreamResult(e4).kind).toBe('artifact-update');
      expect(() => FromProto.messageStreamResult({ payload: undefined })).toThrow();
    });
  });
});

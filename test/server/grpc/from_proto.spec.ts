import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FromProto } from '../../../src/grpc/utils/from_proto.js';
import * as proto from '../../../src/grpc/a2a.js';
import * as idDecoding from '../../../src/grpc/utils/id_decoding.js';
import { A2AError } from '../../../src/server/index.js';

vi.mock('../../../src/grpc/utils/id_decoding.js', () => ({
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
    const request: proto.CreateTaskPushNotificationConfigRequest = {
      parent: 'tasks/task-123',
      configId: 'pnc-456',
      config: {
        name: 'tasks/task-123/pushNotificationConfigs/pnc-456',
        pushNotificationConfig: {
          id: 'pnc-456',
          url: 'http://example.com',
          token: 'token-abc',
          authentication: undefined,
        },
      },
    };
    const result = FromProto.taskPushNotificationConfig(request);
    expect(idDecoding.extractTaskId).toHaveBeenCalledWith(request.parent);
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

    it('should convert a file part with bytes', () => {
      const bytes = Buffer.from('file content');
      const part: proto.Part = {
        part: {
          $case: 'file',
          value: { file: { $case: 'fileWithBytes', value: bytes }, mimeType: 'text/plain' },
        },
      };
      const result = FromProto.part(part);
      expect(result).toEqual({
        kind: 'file',
        file: { bytes: bytes.toString('base64'), mimeType: 'text/plain' },
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
});

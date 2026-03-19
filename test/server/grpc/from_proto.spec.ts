import { describe, it, expect, vi } from 'vitest';
import { FromProto } from '../../../src/types/converters/from_proto.js';
import * as proto from '../../../src/types/pb/a2a_types.js';
import { RequestMalformedError } from '../../../src/errors.js';

vi.mock('../../../src/types/converters/id_decoding.js', () => ({
  extractTaskId: vi.fn((name) => name.replace('tasks/', '')),
  extractTaskAndPushNotificationConfigId: vi.fn(),
}));

describe('FromProto', () => {
  describe('createTaskPushNotificationConfig', () => {
    it('should convert valid request', () => {
      const request: proto.CreateTaskPushNotificationConfigRequest = {
        parent: 'tasks/task-123',
        configId: 'push-1',
        config: {
          name: 'ignored',
          pushNotificationConfig: {
            id: 'push-1',
            url: 'http://example.com',
            token: 'test-token',
            authentication: undefined,
          },
        },
      };

      const result = FromProto.createTaskPushNotificationConfig(request);

      expect(result).toEqual({
        name: 'tasks/task-123/pushNotificationConfigs/push-1',
        pushNotificationConfig: request.config?.pushNotificationConfig,
      });
    });

    it('should throw RequestMalformedError if config is missing', () => {
      const request: proto.CreateTaskPushNotificationConfigRequest = {
        parent: 'tasks/task-123',
        configId: 'push-2',
        config: undefined,
      };
      try {
        FromProto.createTaskPushNotificationConfig(request);
      } catch (error) {
        expect(error).toBeInstanceOf(RequestMalformedError);
        expect((error as RequestMalformedError).message).toContain(
          'Request must include a `config` with `pushNotificationConfig`'
        );
      }
    });

    it('should throw RequestMalformedError if pushNotificationConfig is missing', () => {
      const request: proto.CreateTaskPushNotificationConfigRequest = {
        parent: 'tasks/task-123',
        configId: 'config-name',
        config: { name: 'config-name', pushNotificationConfig: undefined },
      };
      try {
        FromProto.createTaskPushNotificationConfig(request);
      } catch (error) {
        expect(error).toBeInstanceOf(RequestMalformedError);
        expect((error as RequestMalformedError).message).toContain(
          'Request must include a `config` with `pushNotificationConfig`'
        );
      }
    });
  });

  describe('sendMessageResult', () => {
    it('should return task if payload is task', () => {
      const task: proto.Task = {
        id: 'task-1',
        history: [],
        artifacts: [],
        metadata: {},
        status: {
          state: proto.TaskState.TASK_STATE_COMPLETED,
          timestamp: undefined,
          update: undefined,
        },
        contextId: '',
      };
      const response: proto.SendMessageResponse = {
        payload: { $case: 'task', value: task },
      };
      expect(FromProto.sendMessageResult(response)).toEqual(task);
    });

    it('should return message if payload is msg', () => {
      const msg: proto.Message = {
        messageId: 'msg-1',
        role: proto.Role.ROLE_USER,
        content: [],
        extensions: [],
        metadata: {},
        taskId: '',
        contextId: '',
      };
      const response: proto.SendMessageResponse = {
        payload: { $case: 'msg', value: msg },
      };
      expect(FromProto.sendMessageResult(response)).toEqual(msg);
    });

    it('should throw RequestMalformedError if payload is missing', () => {
      const response: proto.SendMessageResponse = {};
      let err: RequestMalformedError | undefined;
      try {
        FromProto.sendMessageResult(response);
      } catch (error) {
        err = error as RequestMalformedError;
      }
      expect(err).toBeInstanceOf(RequestMalformedError);
      expect(err?.message).toContain('Invalid SendMessageResponse: missing result');
    });

    it('should throw RequestMalformedError if payload case is invalid', () => {
      const response = {
        payload: { $case: 'streamError', value: undefined as any },
      } as unknown as proto.SendMessageResponse;
      let err: RequestMalformedError | undefined;
      try {
        FromProto.sendMessageResult(response);
      } catch (error) {
        err = error as RequestMalformedError;
      }
      expect(err).toBeInstanceOf(RequestMalformedError);
      expect(err?.message).toContain('Invalid SendMessageResponse: missing result');
    });
  });

  describe('listTaskPushNotificationConfig', () => {
    it('should return configs array', () => {
      const configs: proto.TaskPushNotificationConfig[] = [
        { name: 'config-1', pushNotificationConfig: undefined },
      ];
      const response: proto.ListTaskPushNotificationConfigResponse = {
        configs,
        nextPageToken: '',
      };
      expect(FromProto.listTaskPushNotificationConfig(response)).toEqual(configs);
    });
  });

  describe('messageStreamResult', () => {
    it('should return payload value if payload is present', () => {
      const task: proto.Task = {
        id: 'task-1',
        history: [],
        artifacts: [],
        metadata: {},
        status: {
          state: proto.TaskState.TASK_STATE_COMPLETED,
          timestamp: undefined,
          update: undefined,
        },
        contextId: '',
      };
      const event: proto.StreamResponse = {
        payload: { $case: 'task', value: task },
      };
      expect(FromProto.messageStreamResult(event)).toEqual(task);
    });

    it('should throw RequestMalformedError if payload is missing', () => {
      const event: proto.StreamResponse = {};
      try {
        FromProto.messageStreamResult(event);
      } catch (error) {
        expect(error).toBeInstanceOf(RequestMalformedError);
        expect((error as RequestMalformedError).message).toContain(
          'Invalid event type in StreamResponse'
        );
      }
    });
  });
});

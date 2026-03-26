import { describe, it, expect, vi } from 'vitest';
import { FromProto } from '../../../src/types/converters/from_proto.js';
import * as proto from '../../../src/types/pb/a2a.js';
import { RequestMalformedError, GenericError } from '../../../src/errors.js';

vi.mock('../../../src/types/converters/id_decoding.js', () => ({
  extractTaskId: vi.fn((name) => name.replace('tasks/', '')),
  extractTaskAndPushNotificationConfigId: vi.fn(),
}));

describe('FromProto', () => {
  describe('createTaskPushNotificationConfig', () => {
    it('should return request as is', () => {
      const request: proto.TaskPushNotificationConfig = {
        taskId: 'task-123',
        id: 'push-1',
        url: 'http://example.com',
        token: 'test-token',
        authentication: undefined,
        tenant: '',
      };

      const result = FromProto.createTaskPushNotificationConfig(request);

      expect(result).toEqual(request);
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

    it('should return message if payload is message', () => {
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
        payload: { $case: 'message', value: msg },
      };
      expect(FromProto.sendMessageResult(response)).toEqual(msg);
    });

    it('should throw GenericError if payload is missing', () => {
      const response: proto.SendMessageResponse = {};
      let err: GenericError | undefined;
      try {
        FromProto.sendMessageResult(response);
      } catch (error) {
        err = error as GenericError;
      }
      expect(err).toBeInstanceOf(GenericError);
      expect(err?.message).toContain('Invalid SendMessageResponse: missing result');
    });

    it('should throw GenericError if payload case is invalid', () => {
      const response = {
        payload: { $case: 'streamError', value: undefined as any },
      } as unknown as proto.SendMessageResponse;
      let err: GenericError | undefined;
      try {
        FromProto.sendMessageResult(response);
      } catch (error) {
        err = error as GenericError;
      }
      expect(err).toBeInstanceOf(GenericError);
      expect(err?.message).toContain('Invalid SendMessageResponse: missing result');
    });
  });

  describe('listTaskPushNotificationConfigs', () => {
    it('should return configs array', () => {
      const configs: proto.TaskPushNotificationConfig[] = [
        {
          taskId: 'task-1',
          id: 'config-1',
          url: 'http://test.com',
          token: '',
          authentication: undefined,
          tenant: '',
        },
      ];
      const response: proto.ListTaskPushNotificationConfigsResponse = {
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

    it('should throw GenericError if payload is missing', () => {
      const event: proto.StreamResponse = {};
      try {
        FromProto.messageStreamResult(event);
      } catch (error) {
        expect(error).toBeInstanceOf(GenericError);
        expect((error as GenericError).message).toContain('Invalid event type in StreamResponse');
      }
    });
  });
});

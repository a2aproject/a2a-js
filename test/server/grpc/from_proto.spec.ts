import { describe, it, expect } from 'vitest';
import { FromProto } from '../../../src/types/converters/from_proto.js';
import * as proto from '../../../src/types/pb/a2a.js';
import { GenericError } from '../../../src/errors.js';

describe('FromProto', () => {
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
          message: undefined,
        } as proto.TaskStatus,
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
        parts: [],
        extensions: [],
        metadata: {},
        taskId: '',
        contextId: '',
        referenceTaskIds: [],
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
});

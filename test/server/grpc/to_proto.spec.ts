import { describe, it, expect } from 'vitest';
import { ToProto } from '../../../src/types/converters/to_proto.js';
import * as proto from '../../../src/types/pb/a2a.js';

describe('ToProto', () => {
  describe('messageSendResult', () => {
    it('should wrap Message in SendMessageResponse', () => {
      const message: proto.Message = {
        messageId: 'msg-1',
        parts: [],
        contextId: '',
        taskId: '',
        role: 0,
        extensions: [],
        metadata: {},
        referenceTaskIds: [],
      };
      const result = ToProto.messageSendResult(message);
      expect(result.payload?.$case).toBe('message');
      expect((result.payload as { value: proto.Message }).value).toBe(message);
    });

    it('should wrap Task in SendMessageResponse', () => {
      const task: proto.Task = {
        id: 'task-123',
        contextId: '',
        status: undefined,
        history: [],
        artifacts: [],
        metadata: undefined,
      };
      const result = ToProto.messageSendResult(task);
      expect(result.payload?.$case).toBe('task');
      expect((result.payload as { value: proto.Task }).value).toBe(task);
    });
  });
});

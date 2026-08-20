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

    it('should wrap minimal Task (without artifacts or status) in SendMessageResponse', () => {
      const task: proto.Task = {
        id: 'task-123',
      };
      const result = ToProto.messageSendResult(task);
      expect(result.payload?.$case).toBe('task');
      expect((result.payload as { value: proto.Task }).value).toBe(task);
    });

    it('should wrap minimal Message (without contextId, taskId) in SendMessageResponse', () => {
      const message: proto.Message = {
        messageId: 'msg-1',
        role: 1,
        parts: [{ content: { $case: 'text', value: 'hello' } }],
      };
      const result = ToProto.messageSendResult(message);
      expect(result.payload?.$case).toBe('message');
      expect((result.payload as { value: proto.Message }).value).toBe(message);
    });
  });
});

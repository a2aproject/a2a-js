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
      expect((result.payload as any).value).toBe(message);
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
      expect((result.payload as any).value).toBe(task);
    });
  });

  describe('messageStreamResult', () => {
    it('should wrap Message in StreamResponse', () => {
      const message: proto.Message = { messageId: 'm1' } as any;
      const result = ToProto.messageStreamResult(message);
      expect(result.payload?.$case).toBe('message');
    });

    it('should wrap Task in StreamResponse', () => {
      const task: proto.Task = { artifacts: [] } as any; // distinct feature of Task
      const result = ToProto.messageStreamResult(task);
      expect(result.payload?.$case).toBe('task');
    });

    it('should wrap TaskStatusUpdateEvent in StreamResponse', () => {
      const event: proto.TaskStatusUpdateEvent = { status: {} } as any;
      const result = ToProto.messageStreamResult(event);
      expect(result.payload?.$case).toBe('statusUpdate');
    });

    it('should wrap TaskArtifactUpdateEvent in StreamResponse', () => {
      const event: proto.TaskArtifactUpdateEvent = { artifact: {} } as any;
      const result = ToProto.messageStreamResult(event);
      expect(result.payload?.$case).toBe('artifactUpdate');
    });
  });
});

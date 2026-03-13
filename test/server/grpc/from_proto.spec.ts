import { describe, it, expect, vi } from 'vitest';
import { FromProto } from '../../../src/types/converters/from_proto.js';
import * as proto from '../../../src/types/pb/a2a_types.js';

vi.mock('../../../src/types/converters/id_decoding.js', () => ({
  extractTaskId: vi.fn((name) => name.replace('tasks/', '')),
  extractTaskAndPushNotificationConfigId: vi.fn(),
}));

describe('FromProto', () => {
  it('should convert part (identity)', () => {
    const part: proto.Part = { part: { $case: 'text', value: 'hello' } };
    expect(FromProto.part(part)).toEqual(part);
  });

  it('should convert CancelTaskRequest to taskIdParams', () => {
    const request: proto.CancelTaskRequest = { name: 'tasks/task-123' };
    const result = FromProto.taskIdParams(request);
    expect(result).toEqual(request);
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

    expect(result).toEqual(request);
  });
});

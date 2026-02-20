import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FromProto } from '../../../src/types/converters/from_proto.js';
import * as proto from '../../../src/types/pb/a2a_types.js';

vi.mock('../../../src/types/converters/id_decoding.js', () => ({
  extractTaskId: vi.fn((name) => name.replace('tasks/', '')),
  extractTaskAndPushNotificationConfigId: vi.fn(),
}));

describe('FromProto', () => {
  // Identity tests for FromProto since Internal types ARE Proto types now.

  it('should pass through valid Message', () => {
    const message: proto.Message = {
      messageId: 'msg-1',
      content: [],
      contextId: 'ctx-1',
      taskId: 'task-1',
      role: proto.Role.ROLE_AGENT,
      metadata: { key: 'value' },
      extensions: ['ext1'],
    };
    const result = FromProto.message(message);
    expect(result).toEqual(message);
  });

  it('should pass through valid Task', () => {
    const task: proto.Task = {
      id: 'task-1',
      contextId: 'ctx-1',
      status: {
        state: proto.TaskState.TASK_STATE_COMPLETED,
        timestamp: undefined,
        update: undefined,
      },
      history: [],
      artifacts: [],
      metadata: undefined,
    };
    const result = FromProto.task(task);
    expect(result).toEqual(task);
  });

  it('should convert part (identity)', () => {
    const part: proto.Part = { part: { $case: 'text', value: 'hello' } };
    expect(FromProto.part(part)).toEqual(part);
  });

  // Non-trivial conversions (parameter extraction)

  it('should convert GetTaskRequest to taskQueryParams', () => {
    const request: proto.GetTaskRequest = {
      name: 'tasks/task-123',
      historyLength: 10,
    };
    const result = FromProto.taskQueryParams(request);
    expect(result).toEqual({
      id: 'task-123',
      historyLength: 10,
    });
  });

  it('should convert CancelTaskRequest to taskIdParams', () => {
    const request: proto.CancelTaskRequest = { name: 'tasks/task-123' };
    const result = FromProto.taskIdParams(request);
    expect(result).toEqual({ id: 'task-123' });
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
      message: request.request,
      configuration: {
        blocking: false,
        acceptedOutputModes: [],
        pushNotificationConfig: undefined,
        historyLength: 0,
      },
      metadata: { client: 'test' },
    });
  });
});

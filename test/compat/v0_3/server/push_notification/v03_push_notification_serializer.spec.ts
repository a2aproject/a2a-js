import { describe, it, expect } from 'vitest';
import { V03PushNotificationSerializer } from '../../../../../src/compat/v0_3/server/push_notification/v03_push_notification_serializer.js';
import { LEGACY_JSON_CONTENT_TYPE } from '../../../../../src/compat/v0_3/constants.js';
import { Role, StreamResponse, TaskState } from '../../../../../src/types/pb/a2a.js';

describe('V03PushNotificationSerializer', () => {
  const serializer = new V03PushNotificationSerializer();

  it('emits the v0.3 legacy content type', () => {
    const event: StreamResponse = {
      payload: {
        $case: 'task',
        value: {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: '2026-04-15T14:00:00Z',
          },
          artifacts: [],
          history: [],
          metadata: {},
        },
      },
    };
    const { contentType } = serializer.serialize(event);
    expect(contentType).toBe(LEGACY_JSON_CONTENT_TYPE);
    expect(LEGACY_JSON_CONTENT_TYPE).toBe('application/json');
  });

  it('serializes a Task payload as a bare v0.3 Task with kind="task"', () => {
    const event: StreamResponse = {
      payload: {
        $case: 'task',
        value: {
          id: 'task-bare',
          contextId: 'ctx-bare',
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: '2026-04-15T14:00:00Z',
          },
          artifacts: [],
          history: [],
          metadata: {},
        },
      },
    };

    const { body } = serializer.serialize(event);
    const parsed = JSON.parse(body);

    // The body MUST be the bare event object.
    expect(parsed).not.toHaveProperty('jsonrpc');
    expect(parsed).not.toHaveProperty('result');
    expect(parsed).not.toHaveProperty('task');
    expect(parsed).not.toHaveProperty('statusUpdate');
    expect(parsed.kind).toBe('task');
    expect(parsed.id).toBe('task-bare');
    expect(parsed.contextId).toBe('ctx-bare');
    expect(parsed.status.state).toBe('completed');
  });

  it('serializes a TaskStatusUpdateEvent as bare with kind="status-update" and computed final', () => {
    const event: StreamResponse = {
      payload: {
        $case: 'statusUpdate',
        value: {
          taskId: 'task-su',
          contextId: 'ctx-su',
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: '2026-04-15T14:00:00Z',
          },
          metadata: {},
        },
      },
    };

    const { body } = serializer.serialize(event);
    const parsed = JSON.parse(body);

    expect(parsed.kind).toBe('status-update');
    expect(parsed.taskId).toBe('task-su');
    expect(parsed.contextId).toBe('ctx-su');
    expect(parsed.status.state).toBe('completed');
    // Per the translator, COMPLETED → final: true.
    expect(parsed.final).toBe(true);
    expect(parsed).not.toHaveProperty('jsonrpc');
    expect(parsed).not.toHaveProperty('statusUpdate');
  });

  it('marks non-terminal status states as final=false', () => {
    const event: StreamResponse = {
      payload: {
        $case: 'statusUpdate',
        value: {
          taskId: 'task-wip',
          contextId: 'ctx-wip',
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: undefined,
            timestamp: '2026-04-15T14:00:00Z',
          },
          metadata: {},
        },
      },
    };
    const parsed = JSON.parse(serializer.serialize(event).body);
    expect(parsed.final).toBe(false);
  });

  it('serializes a TaskArtifactUpdateEvent as bare with kind="artifact-update"', () => {
    const event: StreamResponse = {
      payload: {
        $case: 'artifactUpdate',
        value: {
          taskId: 'task-art',
          contextId: 'ctx-art',
          artifact: {
            artifactId: 'art-1',
            name: 'file.txt',
            description: 'an artifact',
            parts: [
              {
                content: { $case: 'text', value: 'hello' },
                filename: 'file.txt',
                mediaType: 'text/plain',
                metadata: {},
              },
            ],
            metadata: {},
            extensions: [],
          },
          append: false,
          lastChunk: true,
          metadata: {},
        },
      },
    };

    const { body } = serializer.serialize(event);
    const parsed = JSON.parse(body);

    expect(parsed.kind).toBe('artifact-update');
    expect(parsed.taskId).toBe('task-art');
    expect(parsed.contextId).toBe('ctx-art');
    expect(parsed.artifact.artifactId).toBe('art-1');
    expect(parsed.append).toBe(false);
    expect(parsed.lastChunk).toBe(true);
    expect(parsed).not.toHaveProperty('jsonrpc');
    expect(parsed).not.toHaveProperty('artifactUpdate');
  });

  it('serializes a Message payload as bare v0.3 Message with kind="message"', () => {
    // Messages are valid push-notification payloads. The v0.3 wire shape
    // is the bare Message object discriminated by the `kind` field.
    const event: StreamResponse = {
      payload: {
        $case: 'message',
        value: {
          messageId: 'm-1',
          role: Role.ROLE_AGENT,
          parts: [
            {
              content: { $case: 'text', value: 'hello' },
              mediaType: 'text/plain',
              filename: '',
              metadata: {},
            },
          ],
          contextId: 'ctx-msg',
          taskId: 'task-msg',
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
        },
      },
    };

    const { body, contentType } = serializer.serialize(event);
    const parsed = JSON.parse(body);

    expect(contentType).toBe('application/json');
    expect(parsed.kind).toBe('message');
    expect(parsed.messageId).toBe('m-1');
    expect(parsed.contextId).toBe('ctx-msg');
    expect(parsed.taskId).toBe('task-msg');
    // The body MUST be the bare event object.
    expect(parsed).not.toHaveProperty('jsonrpc');
    expect(parsed).not.toHaveProperty('result');
    expect(parsed).not.toHaveProperty('message');
  });

  it('throws when the StreamResponse has no payload', () => {
    const event = { payload: undefined } as unknown as StreamResponse;
    expect(() => serializer.serialize(event)).toThrow(/StreamResponse payload is undefined/);
  });
});

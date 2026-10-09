import { describe, expect, it } from 'vitest';
import { legacyPushNotificationToV1StreamResponse } from '../../../src/compat/v0_3/push_notification.js';
import { A2AError } from '../../../src/compat/v0_3/server/error.js';
import { V03PushNotificationSerializer } from '../../../src/compat/v0_3/server/push_notification/v03_push_notification_serializer.js';
import { Role, TaskState } from '../../../src/types/pb/a2a.js';
import type { StreamResponse, Task } from '../../../src/types/pb/a2a.js';

const serializer = new V03PushNotificationSerializer();

/** Sends a v1.0 event through the v0.3 wire format and back. */
function roundTrip(event: StreamResponse): StreamResponse {
  const { body } = serializer.serialize(event);
  return legacyPushNotificationToV1StreamResponse(JSON.parse(body));
}

const task: Task = {
  id: 'task-1',
  contextId: 'ctx-1',
  status: {
    state: TaskState.TASK_STATE_COMPLETED,
    message: undefined,
    timestamp: '2026-04-15T14:00:00Z',
  },
  artifacts: [],
  history: [],
  metadata: undefined,
};

describe('legacyPushNotificationToV1StreamResponse', () => {
  describe('round-trips what the v0.3 serializer emits', () => {
    it('task', () => {
      const event: StreamResponse = { payload: { $case: 'task', value: task } };
      expect(roundTrip(event)).toEqual(event);
    });

    it('message', () => {
      const event: StreamResponse = {
        payload: {
          $case: 'message',
          value: {
            messageId: 'msg-1',
            contextId: 'ctx-1',
            taskId: 'task-1',
            role: Role.ROLE_AGENT,
            parts: [
              {
                content: { $case: 'text', value: 'hello' },
                filename: '',
                mediaType: '',
                metadata: undefined,
              },
            ],
            metadata: undefined,
            extensions: [],
            referenceTaskIds: [],
          },
        },
      };
      expect(roundTrip(event)).toEqual(event);
    });

    it('statusUpdate', () => {
      const event: StreamResponse = {
        payload: {
          $case: 'statusUpdate',
          value: {
            taskId: 'task-1',
            contextId: 'ctx-1',
            status: {
              state: TaskState.TASK_STATE_WORKING,
              message: undefined,
              timestamp: '2026-04-15T14:00:00Z',
            },
            metadata: undefined,
          },
        },
      };
      expect(roundTrip(event)).toEqual(event);
    });

    it('artifactUpdate', () => {
      const event: StreamResponse = {
        payload: {
          $case: 'artifactUpdate',
          value: {
            taskId: 'task-1',
            contextId: 'ctx-1',
            artifact: {
              artifactId: 'art-1',
              name: '',
              description: '',
              parts: [
                {
                  content: { $case: 'text', value: 'chunk' },
                  filename: '',
                  mediaType: '',
                  metadata: undefined,
                },
              ],
              metadata: undefined,
              extensions: [],
            },
            append: true,
            lastChunk: true,
            metadata: undefined,
          },
        },
      };
      expect(roundTrip(event)).toEqual(event);
    });
  });

  it('accepts a hand-written v0.3 body, not only serializer output', () => {
    const result = legacyPushNotificationToV1StreamResponse({
      kind: 'task',
      id: 'task-9',
      contextId: 'ctx-9',
      status: { state: 'working' },
    });
    expect(result.payload?.$case).toBe('task');
    expect(result.payload?.value).toMatchObject({ id: 'task-9', contextId: 'ctx-9' });
  });

  it('maps an unknown v0.3 task state to TASK_STATE_UNSPECIFIED rather than throwing', () => {
    const result = legacyPushNotificationToV1StreamResponse({
      kind: 'task',
      id: 'task-9',
      contextId: 'ctx-9',
      status: { state: 'not-a-real-state' },
    });
    expect(result.payload?.$case).toBe('task');
    expect((result.payload as { value: { status: { state: TaskState } } }).value.status.state).toBe(
      TaskState.TASK_STATE_UNSPECIFIED
    );
  });

  describe('rejects malformed input with invalidParams', () => {
    it.each([
      ['null', null],
      ['a string', '{"kind":"task"}'],
      ['an array', [{ kind: 'task' }]],
      ['a missing kind', { id: 'task-1', contextId: 'ctx-1' }],
      ['an unknown kind', { kind: 'task-update', id: 'task-1' }],
      ['a JSON-RPC envelope', { jsonrpc: '2.0', id: 1, result: { kind: 'task' } }],
      ['a task with no id', { kind: 'task', contextId: 'ctx-1', status: { state: 'working' } }],
      ['a task with no contextId', { kind: 'task', id: 'task-1', status: { state: 'working' } }],
      ['a task with no status', { kind: 'task', id: 'task-1', contextId: 'ctx-1' }],
      [
        'a task with a non-object status',
        { kind: 'task', id: 't', contextId: 'c', status: 'working' },
      ],
      [
        'a status-update with no taskId',
        { kind: 'status-update', contextId: 'c', status: { state: 'working' } },
      ],
      [
        'an artifact-update with no artifact',
        { kind: 'artifact-update', taskId: 't', contextId: 'c' },
      ],
      ['a message with no messageId', { kind: 'message', role: 'agent', parts: [] }],
    ])('rejects %s', (_label, body) => {
      expect(() => legacyPushNotificationToV1StreamResponse(body)).toThrowError(A2AError);
    });
  });

  it('names the offending field in the error message', () => {
    expect(() =>
      legacyPushNotificationToV1StreamResponse({ kind: 'task', id: 't', contextId: 'c' })
    ).toThrowError(/task\.status/);
  });
});

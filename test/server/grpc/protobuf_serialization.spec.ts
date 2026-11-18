import { describe, expect, it } from 'vitest';
import { A2AServiceService, SendMessageResponse } from '../../../src/grpc/pb/a2a.js';
import { Role } from '../../../src/index.js';

describe('gRPC protobuf serialization', () => {
  it('preserves null values in task metadata', () => {
    const response: SendMessageResponse = {
      payload: {
        $case: 'task',
        value: {
          id: 'task-1',
          contextId: 'context-1',
          status: undefined,
          artifacts: [],
          history: [],
          metadata: {
            direct: null,
            nested: { value: null },
            items: [null, 'present'],
          },
        },
      },
    };

    const serialized = A2AServiceService.sendMessage.responseSerialize(response);
    const deserialized = A2AServiceService.sendMessage.responseDeserialize(serialized);

    expect(deserialized).toEqual(response);
  });

  it('round-trips v1.1 fields and leaves them out when unset', () => {
    const response: SendMessageResponse = {
      payload: {
        $case: 'task',
        value: {
          id: 'task-1',
          contextId: 'context-1',
          status: undefined,
          artifacts: [
            {
              artifactId: 'a',
              name: '',
              description: '',
              parts: [],
              metadata: undefined,
              extensions: [],
              startGeneration: 2,
              endGeneration: 3,
              role: Role.ROLE_USER,
            },
          ],
          history: [],
          timeline: [
            {
              entry: {
                $case: 'status',
                value: { state: 2, message: undefined, timestamp: undefined },
              },
              generation: 1,
            },
          ],
          metadata: undefined,
          generation: 3,
        },
      },
    };
    const roundTrip = (r: SendMessageResponse) =>
      A2AServiceService.sendMessage.responseDeserialize(
        A2AServiceService.sendMessage.responseSerialize(r)
      );

    expect(roundTrip(response)).toEqual(response);

    const v10: SendMessageResponse = {
      payload: {
        $case: 'task',
        value: {
          id: 'task-1',
          contextId: 'context-1',
          status: undefined,
          artifacts: [],
          history: [],
          metadata: undefined,
        },
      },
    };
    expect(roundTrip(v10)).toEqual(v10);
  });
});

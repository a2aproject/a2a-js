import { describe, expect, it } from 'vitest';
import { A2AServiceService, SendMessageResponse } from '../../../src/grpc/pb/a2a.js';

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
});

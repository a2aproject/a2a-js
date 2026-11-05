import {
  AgentCard,
  Message,
  Role,
  SendMessageRequest,
  StreamResponse,
} from '../../../src/types/pb/a2a.js';

export const agentCard: AgentCard = {
  name: 'Delayed Integration Agent',
  description: 'Agent used to exercise non-default task store and event bus implementations',
  version: '1.0.0',
  provider: undefined,
  documentationUrl: '',
  supportedInterfaces: [
    {
      url: 'http://localhost/a2a',
      protocolBinding: 'HTTP+JSON',
      tenant: '',
      protocolVersion: '1.0',
    },
  ],
  capabilities: {
    extensions: [],
    streaming: true,
    pushNotifications: false,
  },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
  signatures: [],
};

export function makeMessage(messageId: string, text = 'kick off'): Message {
  return {
    messageId,
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: 'text', value: text },
        mediaType: 'text/plain',
        filename: '',
        metadata: undefined,
      },
    ],
    taskId: '',
    contextId: '',
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  };
}

export function makeParams(messageId: string, text = 'kick off'): SendMessageRequest {
  return {
    message: makeMessage(messageId, text),
    tenant: '',
    configuration: undefined,
    metadata: {},
  };
}

/** Collects every event from a stream, failing loudly rather than hanging. */
export async function drain(
  stream: AsyncGenerator<StreamResponse, void, undefined>,
  timeoutMs = 10_000
): Promise<StreamResponse[]> {
  const collected: StreamResponse[] = [];
  const deadline = setTimeout(() => {
    throw new Error(`Stream did not close within ${timeoutMs}ms`);
  }, timeoutMs);
  try {
    for await (const event of stream) collected.push(event);
  } finally {
    clearTimeout(deadline);
  }
  return collected;
}

/** Narrows the terminal state out of a collected stream, if any. */
export function lastState(events: StreamResponse[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const payload = events[i].payload;
    if (payload?.$case === 'statusUpdate') return payload.value.status?.state;
    if (payload?.$case === 'task') return payload.value.status?.state;
  }
  return undefined;
}

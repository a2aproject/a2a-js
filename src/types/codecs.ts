import * as pb from './pb/a2a.js';
import type { MessageFns } from './pb/a2a.js';

export * from './pb/a2a.js';

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export type Part = pb.Part;
export const Part: MessageFns<pb.Part> = {
  ...pb.Part,
  fromJSON(object: unknown): pb.Part {
    const obj = object as Record<string, unknown> | null | undefined;
    if (obj && !isSet(obj.text) && !isSet(obj.raw) && !isSet(obj.url) && obj.data !== undefined) {
      const base = pb.Part.fromJSON(object);
      return {
        ...base,
        content: { $case: 'data', value: obj.data },
      };
    }
    return pb.Part.fromJSON(object);
  },
  toJSON(message: pb.Part): unknown {
    return pb.Part.toJSON(message);
  },
};

export type Message = pb.Message;
export const Message: MessageFns<pb.Message> = {
  ...pb.Message,
  fromJSON(object: unknown): pb.Message {
    const obj = object as Record<string, unknown> | null | undefined;
    const base = pb.Message.fromJSON(object);
    if (globalThis.Array.isArray(obj?.parts)) {
      base.parts = obj!.parts.map((e: unknown) => Part.fromJSON(e));
    }
    return base;
  },
  toJSON(message: pb.Message): unknown {
    const obj = pb.Message.toJSON(message) as Record<string, unknown>;
    if (message.parts?.length) {
      obj.parts = message.parts.map((e) => Part.toJSON(e));
    }
    return obj;
  },
};

export type Task = pb.Task;
export const Task: MessageFns<pb.Task> = {
  ...pb.Task,
  fromJSON(object: unknown): pb.Task {
    const obj = object as Record<string, unknown> | null | undefined;
    const base = pb.Task.fromJSON(object);
    if (globalThis.Array.isArray(obj?.history)) {
      base.history = obj!.history.map((e: unknown) => Message.fromJSON(e));
    }
    return base;
  },
  toJSON(message: pb.Task): unknown {
    const obj = pb.Task.toJSON(message) as Record<string, unknown>;
    if (message.history?.length) {
      obj.history = message.history.map((e) => Message.toJSON(e));
    }
    return obj;
  },
};

export type SendMessageRequest = pb.SendMessageRequest;
export const SendMessageRequest: MessageFns<pb.SendMessageRequest> = {
  ...pb.SendMessageRequest,
  fromJSON(object: unknown): pb.SendMessageRequest {
    const obj = object as Record<string, unknown> | null | undefined;
    const base = pb.SendMessageRequest.fromJSON(object);
    if (isSet(obj?.message)) {
      base.message = Message.fromJSON(obj!.message);
    }
    return base;
  },
  toJSON(message: pb.SendMessageRequest): unknown {
    const obj = pb.SendMessageRequest.toJSON(message) as Record<string, unknown>;
    if (message.message !== undefined) {
      obj.message = Message.toJSON(message.message);
    }
    return obj;
  },
};

export type SendMessageResponse = pb.SendMessageResponse;
export const SendMessageResponse: MessageFns<pb.SendMessageResponse> = {
  ...pb.SendMessageResponse,
  fromJSON(object: unknown): pb.SendMessageResponse {
    const obj = object as Record<string, unknown> | null | undefined;
    if (isSet(obj?.task)) {
      return { payload: { $case: 'task', value: Task.fromJSON(obj!.task) } };
    }
    if (isSet(obj?.message)) {
      return { payload: { $case: 'message', value: Message.fromJSON(obj!.message) } };
    }
    return pb.SendMessageResponse.fromJSON(object);
  },
  toJSON(message: pb.SendMessageResponse): unknown {
    const obj: Record<string, unknown> = {};
    if (message.payload?.$case === 'task') {
      obj.task = Task.toJSON(message.payload.value);
    } else if (message.payload?.$case === 'message') {
      obj.message = Message.toJSON(message.payload.value);
    }
    return obj;
  },
};

export type StreamResponse = pb.StreamResponse;
export const StreamResponse: MessageFns<pb.StreamResponse> = {
  ...pb.StreamResponse,
  fromJSON(object: unknown): pb.StreamResponse {
    const obj = object as Record<string, unknown> | null | undefined;
    if (isSet(obj?.task)) {
      return { payload: { $case: 'task', value: Task.fromJSON(obj!.task) } };
    }
    if (isSet(obj?.message)) {
      return { payload: { $case: 'message', value: Message.fromJSON(obj!.message) } };
    }
    return pb.StreamResponse.fromJSON(object);
  },
  toJSON(message: pb.StreamResponse): unknown {
    if (message.payload?.$case === 'task') {
      return { task: Task.toJSON(message.payload.value) };
    }
    if (message.payload?.$case === 'message') {
      return { message: Message.toJSON(message.payload.value) };
    }
    return pb.StreamResponse.toJSON(message);
  },
};

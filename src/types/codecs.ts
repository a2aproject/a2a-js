import * as pb from './pb/a2a.js';
import type { MessageFns } from './pb/a2a.js';

export * from './pb/a2a.js';

export type Part = pb.Part;
export type Message = pb.Message;
export type Artifact = pb.Artifact;
export type Task = pb.Task;
export type SendMessageResponse = pb.SendMessageResponse;

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export const Part: MessageFns<pb.Part> = {
  ...pb.Part,
  fromJSON(object: unknown): pb.Part {
    if (object != null && typeof object === 'object') {
      const record = object as Record<string, unknown>;
      const contentKeys = [
        isSet(record.text) ? 'text' : undefined,
        isSet(record.raw) ? 'raw' : undefined,
        isSet(record.url) ? 'url' : undefined,
        isSet(record.data) ? 'data' : undefined,
      ].filter((k): k is string => k !== undefined);
      if (contentKeys.length > 1) {
        throw new globalThis.Error(
          `Message type "lf.a2a.v1.Part" should not have multiple "content" oneof fields: ${contentKeys.join(', ')}`
        );
      }
    }
    return pb.Part.fromJSON(object);
  },
};

export const Message: MessageFns<pb.Message> = {
  ...pb.Message,
  fromJSON(object: unknown): pb.Message {
    if (object != null && typeof object === 'object') {
      const record = object as Record<string, unknown>;
      if (Array.isArray(record.parts)) {
        for (const part of record.parts) {
          Part.fromJSON(part);
        }
      }
    }
    return pb.Message.fromJSON(object);
  },
};

export const Artifact: MessageFns<pb.Artifact> = {
  ...pb.Artifact,
  fromJSON(object: unknown): pb.Artifact {
    if (object != null && typeof object === 'object') {
      const record = object as Record<string, unknown>;
      if (Array.isArray(record.parts)) {
        for (const part of record.parts) {
          Part.fromJSON(part);
        }
      }
    }
    return pb.Artifact.fromJSON(object);
  },
};

export const Task: MessageFns<pb.Task> = {
  ...pb.Task,
  fromJSON(object: unknown): pb.Task {
    if (object != null && typeof object === 'object') {
      const record = object as Record<string, unknown>;
      if (Array.isArray(record.history)) {
        for (const msg of record.history) {
          Message.fromJSON(msg);
        }
      }
      if (Array.isArray(record.artifacts)) {
        for (const art of record.artifacts) {
          Artifact.fromJSON(art);
        }
      }
    }
    return pb.Task.fromJSON(object);
  },
};

export const SendMessageResponse: MessageFns<pb.SendMessageResponse> = {
  ...pb.SendMessageResponse,
  fromJSON(object: unknown): pb.SendMessageResponse {
    if (object != null && typeof object === 'object') {
      const record = object as Record<string, unknown>;
      if (record.task) {
        Task.fromJSON(record.task);
      }
      if (record.message) {
        Message.fromJSON(record.message);
      }
    }
    return pb.SendMessageResponse.fromJSON(object);
  },
};

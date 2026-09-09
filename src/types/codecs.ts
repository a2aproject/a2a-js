import * as pb from './pb/a2a.js';
import type { MessageFns } from './pb/a2a.js';

export * from './pb/a2a.js';

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export function fromJsonTimestamp(o: unknown): string {
  if (o instanceof globalThis.Date) {
    return o.toISOString();
  } else if (typeof o === 'string' && o.trim() !== '') {
    const d = new globalThis.Date(o);
    if (!globalThis.isNaN(d.getTime())) {
      if (o.endsWith('Z') || o.endsWith('z')) {
        return o;
      }
      return d.toISOString().replace(/\.000Z$/, 'Z');
    }
  }
  throw new globalThis.Error(`Value is not a valid timestamp: ${JSON.stringify(o)}`);
}

export type TaskStatus = pb.TaskStatus;
export const TaskStatus: MessageFns<pb.TaskStatus> = {
  ...pb.TaskStatus,
  fromJSON(object: unknown): pb.TaskStatus {
    const obj = object as Record<string, unknown> | null | undefined;
    const base = pb.TaskStatus.fromJSON(object);
    if (isSet(obj?.timestamp)) {
      base.timestamp = fromJsonTimestamp(obj!.timestamp);
    }
    return base;
  },
  toJSON(message: pb.TaskStatus): unknown {
    return pb.TaskStatus.toJSON(message);
  },
};

export type ListTasksRequest = pb.ListTasksRequest;
export const ListTasksRequest: MessageFns<pb.ListTasksRequest> = {
  ...pb.ListTasksRequest,
  fromJSON(object: unknown): pb.ListTasksRequest {
    const obj = object as Record<string, unknown> | null | undefined;
    const base = pb.ListTasksRequest.fromJSON(object);
    if (isSet(obj?.statusTimestampAfter)) {
      base.statusTimestampAfter = fromJsonTimestamp(obj!.statusTimestampAfter);
    } else if (isSet(obj?.status_timestamp_after)) {
      base.statusTimestampAfter = fromJsonTimestamp(obj!.status_timestamp_after);
    }
    return base;
  },
  toJSON(message: pb.ListTasksRequest): unknown {
    return pb.ListTasksRequest.toJSON(message);
  },
};

export type Task = pb.Task;
export const Task: MessageFns<pb.Task> = {
  ...pb.Task,
  fromJSON(object: unknown): pb.Task {
    const obj = object as Record<string, unknown> | null | undefined;
    const base = pb.Task.fromJSON(object);
    if (isSet(obj?.status)) {
      base.status = TaskStatus.fromJSON(obj!.status);
    }
    return base;
  },
  toJSON(message: pb.Task): unknown {
    const obj = pb.Task.toJSON(message) as Record<string, unknown>;
    if (message.status !== undefined) {
      obj.status = TaskStatus.toJSON(message.status);
    }
    return obj;
  },
};

export type TaskStatusUpdateEvent = pb.TaskStatusUpdateEvent;
export const TaskStatusUpdateEvent: MessageFns<pb.TaskStatusUpdateEvent> = {
  ...pb.TaskStatusUpdateEvent,
  fromJSON(object: unknown): pb.TaskStatusUpdateEvent {
    const obj = object as Record<string, unknown> | null | undefined;
    const base = pb.TaskStatusUpdateEvent.fromJSON(object);
    if (isSet(obj?.status)) {
      base.status = TaskStatus.fromJSON(obj!.status);
    }
    return base;
  },
  toJSON(message: pb.TaskStatusUpdateEvent): unknown {
    const obj = pb.TaskStatusUpdateEvent.toJSON(message) as Record<string, unknown>;
    if (message.status !== undefined) {
      obj.status = TaskStatus.toJSON(message.status);
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
    return pb.SendMessageResponse.fromJSON(object);
  },
  toJSON(message: pb.SendMessageResponse): unknown {
    const obj: Record<string, unknown> = {};
    if (message.payload?.$case === 'task') {
      obj.task = Task.toJSON(message.payload.value);
    } else if (message.payload?.$case === 'message') {
      obj.message = pb.Message.toJSON(message.payload.value);
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
    const statusUpdate = obj?.statusUpdate ?? obj?.status_update;
    if (isSet(statusUpdate)) {
      return {
        payload: { $case: 'statusUpdate', value: TaskStatusUpdateEvent.fromJSON(statusUpdate) },
      };
    }
    return pb.StreamResponse.fromJSON(object);
  },
  toJSON(message: pb.StreamResponse): unknown {
    if (message.payload?.$case === 'task') {
      return { task: Task.toJSON(message.payload.value) };
    }
    if (message.payload?.$case === 'statusUpdate') {
      return { statusUpdate: TaskStatusUpdateEvent.toJSON(message.payload.value) };
    }
    return pb.StreamResponse.toJSON(message);
  },
};

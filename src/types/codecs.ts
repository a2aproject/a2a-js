import * as pb from './pb/a2a.js';
import type { MessageFns } from './pb/a2a.js';

export * from './pb/a2a.js';

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export function taskStateFromJSON(object: unknown): pb.TaskState {
  switch (object) {
    case 0:
    case 'TASK_STATE_UNSPECIFIED':
      return pb.TaskState.TASK_STATE_UNSPECIFIED;
    case 1:
    case 'TASK_STATE_SUBMITTED':
      return pb.TaskState.TASK_STATE_SUBMITTED;
    case 2:
    case 'TASK_STATE_WORKING':
      return pb.TaskState.TASK_STATE_WORKING;
    case 3:
    case 'TASK_STATE_COMPLETED':
      return pb.TaskState.TASK_STATE_COMPLETED;
    case 4:
    case 'TASK_STATE_FAILED':
      return pb.TaskState.TASK_STATE_FAILED;
    case 5:
    case 'TASK_STATE_CANCELED':
      return pb.TaskState.TASK_STATE_CANCELED;
    case 6:
    case 'TASK_STATE_INPUT_REQUIRED':
      return pb.TaskState.TASK_STATE_INPUT_REQUIRED;
    case 7:
    case 'TASK_STATE_REJECTED':
      return pb.TaskState.TASK_STATE_REJECTED;
    case 8:
    case 'TASK_STATE_AUTH_REQUIRED':
      return pb.TaskState.TASK_STATE_AUTH_REQUIRED;
    case -1:
    case 'UNRECOGNIZED':
      return pb.TaskState.UNRECOGNIZED;
    default:
      return typeof object === 'number' ? (object as pb.TaskState) : pb.TaskState.UNRECOGNIZED;
  }
}

export function taskStateToJSON(object: pb.TaskState): string | number {
  switch (object) {
    case pb.TaskState.TASK_STATE_UNSPECIFIED:
      return 'TASK_STATE_UNSPECIFIED';
    case pb.TaskState.TASK_STATE_SUBMITTED:
      return 'TASK_STATE_SUBMITTED';
    case pb.TaskState.TASK_STATE_WORKING:
      return 'TASK_STATE_WORKING';
    case pb.TaskState.TASK_STATE_COMPLETED:
      return 'TASK_STATE_COMPLETED';
    case pb.TaskState.TASK_STATE_FAILED:
      return 'TASK_STATE_FAILED';
    case pb.TaskState.TASK_STATE_CANCELED:
      return 'TASK_STATE_CANCELED';
    case pb.TaskState.TASK_STATE_INPUT_REQUIRED:
      return 'TASK_STATE_INPUT_REQUIRED';
    case pb.TaskState.TASK_STATE_REJECTED:
      return 'TASK_STATE_REJECTED';
    case pb.TaskState.TASK_STATE_AUTH_REQUIRED:
      return 'TASK_STATE_AUTH_REQUIRED';
    case pb.TaskState.UNRECOGNIZED:
      return 'UNRECOGNIZED';
    default:
      return typeof object === 'number' && object !== -1 ? object : 'UNRECOGNIZED';
  }
}

export function roleFromJSON(object: unknown): pb.Role {
  switch (object) {
    case 0:
    case 'ROLE_UNSPECIFIED':
      return pb.Role.ROLE_UNSPECIFIED;
    case 1:
    case 'ROLE_USER':
      return pb.Role.ROLE_USER;
    case 2:
    case 'ROLE_AGENT':
      return pb.Role.ROLE_AGENT;
    case -1:
    case 'UNRECOGNIZED':
      return pb.Role.UNRECOGNIZED;
    default:
      return typeof object === 'number' ? (object as pb.Role) : pb.Role.UNRECOGNIZED;
  }
}

export function roleToJSON(object: pb.Role): string | number {
  switch (object) {
    case pb.Role.ROLE_UNSPECIFIED:
      return 'ROLE_UNSPECIFIED';
    case pb.Role.ROLE_USER:
      return 'ROLE_USER';
    case pb.Role.ROLE_AGENT:
      return 'ROLE_AGENT';
    case pb.Role.UNRECOGNIZED:
      return 'UNRECOGNIZED';
    default:
      return typeof object === 'number' && object !== -1 ? object : 'UNRECOGNIZED';
  }
}

export type TaskStatus = pb.TaskStatus;
export const TaskStatus: MessageFns<pb.TaskStatus> = {
  ...pb.TaskStatus,
  fromJSON(object: unknown): pb.TaskStatus {
    const obj = object as Record<string, unknown> | null | undefined;
    const base = pb.TaskStatus.fromJSON(object);
    if (isSet(obj?.state)) {
      base.state = taskStateFromJSON(obj!.state);
    }
    if (isSet(obj?.message)) {
      base.message = Message.fromJSON(obj!.message);
    }
    return base;
  },
  toJSON(message: pb.TaskStatus): unknown {
    const obj = pb.TaskStatus.toJSON(message) as Record<string, unknown>;
    if (message.state !== 0) {
      obj.state = taskStateToJSON(message.state);
    }
    if (message.message !== undefined) {
      obj.message = Message.toJSON(message.message);
    }
    return obj;
  },
};

export type Message = pb.Message;
export const Message: MessageFns<pb.Message> = {
  ...pb.Message,
  fromJSON(object: unknown): pb.Message {
    const obj = object as Record<string, unknown> | null | undefined;
    const base = pb.Message.fromJSON(object);
    if (isSet(obj?.role)) {
      base.role = roleFromJSON(obj!.role);
    }
    return base;
  },
  toJSON(message: pb.Message): unknown {
    const obj = pb.Message.toJSON(message) as Record<string, unknown>;
    if (message.role !== 0) {
      obj.role = roleToJSON(message.role);
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
    if (isSet(obj?.status)) {
      base.status = TaskStatus.fromJSON(obj!.status);
    }
    if (globalThis.Array.isArray(obj?.history)) {
      base.history = obj!.history.map((e: unknown) => Message.fromJSON(e));
    }
    return base;
  },
  toJSON(message: pb.Task): unknown {
    const obj = pb.Task.toJSON(message) as Record<string, unknown>;
    if (message.status !== undefined) {
      obj.status = TaskStatus.toJSON(message.status);
    }
    if (message.history?.length) {
      obj.history = message.history.map((e) => Message.toJSON(e));
    }
    return obj;
  },
};

export type ListTasksRequest = pb.ListTasksRequest;
export const ListTasksRequest: MessageFns<pb.ListTasksRequest> = {
  ...pb.ListTasksRequest,
  fromJSON(object: unknown): pb.ListTasksRequest {
    const obj = object as Record<string, unknown> | null | undefined;
    const base = pb.ListTasksRequest.fromJSON(object);
    if (isSet(obj?.status)) {
      base.status = taskStateFromJSON(obj!.status);
    }
    return base;
  },
  toJSON(message: pb.ListTasksRequest): unknown {
    const obj = pb.ListTasksRequest.toJSON(message) as Record<string, unknown>;
    if (message.status !== 0) {
      obj.status = taskStateToJSON(message.status);
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
    if (message.payload?.$case === 'message') {
      return { message: Message.toJSON(message.payload.value) };
    }
    if (message.payload?.$case === 'statusUpdate') {
      return { statusUpdate: TaskStatusUpdateEvent.toJSON(message.payload.value) };
    }
    return pb.StreamResponse.toJSON(message);
  },
};

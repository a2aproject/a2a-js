// The test data the database store suites share. The edge suites import it in workerd, so
// nothing here may pull in a Node built-in.
import { ServerCallContext } from '../../../src/server/context.js';
import type { User } from '../../../src/server/authentication/user.js';
import {
  Role,
  TaskState,
  type Artifact,
  type ListTasksRequest,
  type Message,
  type Task,
  type TaskPushNotificationConfig,
} from '../../../src/types/pb/a2a.js';

class TestUser implements User {
  constructor(private readonly _userName: string) {}
  get isAuthenticated(): boolean {
    return true;
  }
  get userName(): string {
    return this._userName;
  }
}

export function makeContext(
  options: { tenant?: string; user?: string; version?: string } = {}
): ServerCallContext {
  return new ServerCallContext({
    tenant: options.tenant,
    user: options.user === undefined ? undefined : new TestUser(options.user),
    requestedVersion: options.version,
  });
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    messageId: 'msg-1',
    contextId: 'ctx-1',
    taskId: 'task-1',
    role: Role.ROLE_USER,
    parts: [{ content: { $case: 'text', value: 'hello' }, mediaType: 'text/plain', filename: '' }],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
    ...overrides,
  } as Message;
}

export function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    artifactId: 'artifact-1',
    name: 'report',
    description: 'the output',
    parts: [{ content: { $case: 'text', value: 'result' }, mediaType: 'text/plain', filename: '' }],
    metadata: undefined,
    extensions: [],
    ...overrides,
  } as Artifact;
}

/** Already in the shape `Task.fromJSON` produces, so a round trip compares equal. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    contextId: 'ctx-1',
    status: {
      state: TaskState.TASK_STATE_WORKING,
      message: undefined,
      timestamp: '2026-01-02T03:04:05.678Z',
    },
    artifacts: [],
    history: [],
    metadata: undefined,
    ...overrides,
  };
}

/** Every field the interface demands, so a test states only what it varies. */
export function makeListRequest(overrides: Partial<ListTasksRequest> = {}): ListTasksRequest {
  return {
    tenant: '',
    contextId: '',
    status: TaskState.TASK_STATE_UNSPECIFIED,
    pageToken: '',
    statusTimestampAfter: undefined,
    ...overrides,
  };
}

export function makeConfig(
  overrides: Partial<TaskPushNotificationConfig> = {}
): TaskPushNotificationConfig {
  return {
    tenant: '',
    taskId: 'task-1',
    id: 'cfg-1',
    url: 'http://example.test/webhook',
    token: 'token',
    authentication: undefined,
    ...overrides,
  };
}

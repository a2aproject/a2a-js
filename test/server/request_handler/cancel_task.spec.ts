import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import {
  AgentEvent,
  AgentExecutor,
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryPushNotificationStore,
  InMemoryTaskStore,
  RequestContext,
  TaskStore,
} from '../../../src/server/index.js';
import {
  AgentCard,
  CancelTaskRequest,
  Part,
  Role,
  SendMessageRequest,
  StreamResponse,
  Task,
  TaskState,
} from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';
import { MockPushNotificationSender } from '../mocks/push_notification_sender.mock.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Cancellation idempotency: multiple cancellation requests have the same effect.
// Other cancel contract coverage lives in default_request_handler.spec.ts.
describe('DefaultRequestHandler.cancelTask idempotency (§3.3.1)', () => {
  let handler: DefaultRequestHandler;
  let taskStore: TaskStore;
  let mockExecutor: MockAgentExecutor;
  let eventBusManager: DefaultExecutionEventBusManager;

  const agentCard: AgentCard = {
    name: 'Cancel Task Agent',
    description: 'Test agent for §3.3.1 cancel idempotency',
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

  const serverContext = new ServerCallContext();

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    mockExecutor = new MockAgentExecutor();
    eventBusManager = new DefaultExecutionEventBusManager();
    handler = new DefaultRequestHandler(agentCard, taskStore, mockExecutor, eventBusManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const cancelReq = (id: string): CancelTaskRequest => ({
    id,
    tenant: '',
    metadata: {},
  });

  const makeTask = (id: string, state: TaskState): Task => ({
    id,
    contextId: `ctx-${id}`,
    status: { state, message: undefined, timestamp: undefined },
    artifacts: [],
    history: [],
    metadata: {},
  });

  it('returns the snapshot (no throw) when canceling an already-canceled task', async () => {
    // A second cancel returns the snapshot, not TaskNotCancelableError.
    const taskId = 'task-double-cancel';
    const persisted = makeTask(taskId, TaskState.TASK_STATE_CANCELED);
    await taskStore.save(persisted, serverContext);

    const result = await handler.cancelTask(cancelReq(taskId), serverContext);

    expect(result.id).toBe(taskId);
    expect(result.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    // Idempotency is a no-op — the executor must not be re-signaled.
    expect(mockExecutor.cancelTask).not.toHaveBeenCalled();
  });
});

describe('DefaultRequestHandler.cancelTask persistence ownership (#798)', () => {
  const agentCard: AgentCard = {
    name: 'Cancel Persistence Agent',
    description: 'Test agent for single artifact append persistence during cancellation',
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
      pushNotifications: true,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };

  const serverContext = new ServerCallContext();

  const part = (value: string): Part => ({
    content: { $case: 'text', value },
    mediaType: 'text/plain',
    filename: '',
    metadata: {},
  });

  const artifactText = (task: Task | undefined): string =>
    (task?.artifacts ?? [])
      .flatMap((a) => a.parts ?? [])
      .map((p) => (p.content?.$case === 'text' ? p.content.value : ''))
      .join('');

  const sendReq = (messageId: string, returnImmediately?: boolean): SendMessageRequest => ({
    message: {
      messageId,
      role: Role.ROLE_USER,
      parts: [part('test')],
      taskId: '',
      contextId: '',
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    },
    tenant: '',
    configuration:
      returnImmediately !== undefined
        ? {
            returnImmediately,
            acceptedOutputModes: [],
            taskPushNotificationConfig: undefined,
          }
        : undefined,
    metadata: {},
  });

  function createControlledHarness(saveDelayMs = 0) {
    const initialSaved = deferred<string>();
    const cancelEntered = deferred<void>();
    const finish = deferred<void>();
    const memory = new InMemoryTaskStore();

    const store: TaskStore = {
      load: (...args) => memory.load(...args),
      list: (...args) => memory.list(...args),
      async save(task, context) {
        if (saveDelayMs > 0) {
          await new Promise<void>((r) => setTimeout(r, saveDelayMs));
        }
        await memory.save(task, context);
        if (artifactText(task) === 'A') {
          initialSaved.resolve(task.id);
        }
      },
    };

    let live!: { ctx: RequestContext; bus: ExecutionEventBus };

    const publishChunk = (value: string, append: boolean) => {
      live.bus.publish(
        AgentEvent.artifactUpdate({
          taskId: live.ctx.taskId,
          contextId: live.ctx.contextId,
          artifact: {
            artifactId: 'output',
            name: '',
            description: '',
            parts: [part(value)],
            metadata: {},
            extensions: [],
          },
          append,
          lastChunk: false,
          metadata: {},
        })
      );
    };

    const publishStatus = (state: TaskState) => {
      live.bus.publish(
        AgentEvent.statusUpdate({
          taskId: live.ctx.taskId,
          contextId: live.ctx.contextId,
          status: {
            state,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
    };

    const executor: AgentExecutor = {
      async execute(ctx, bus) {
        live = { ctx, bus };
        bus.publish(
          AgentEvent.task({
            id: ctx.taskId,
            contextId: ctx.contextId,
            status: {
              state: TaskState.TASK_STATE_WORKING,
              message: undefined,
              timestamp: undefined,
            },
            artifacts: [],
            history: [],
            metadata: {},
          })
        );
        publishChunk('A', false);
        await finish.promise;
      },
      async cancelTask() {
        cancelEntered.resolve();
      },
    };

    return {
      store,
      executor,
      initialSaved,
      cancelEntered,
      finish,
      publishChunk,
      publishStatus,
      getLive: () => live,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists live append updates once when cancelTask overlaps blocking sendMessage', async () => {
    const { store, executor, initialSaved, cancelEntered, finish, publishChunk, publishStatus } =
      createControlledHarness();
    const handler = new DefaultRequestHandler(agentCard, store, executor);

    const sending = handler.sendMessage(sendReq('msg-blocking-cancel'), serverContext);
    const id = await initialSaved.promise;

    const cancellation = handler.cancelTask({ id, tenant: '', metadata: {} }, serverContext);
    await cancelEntered.promise;

    publishChunk('B', true);
    publishChunk('C', true);
    publishStatus(TaskState.TASK_STATE_CANCELED);
    finish.resolve();

    const [sendResult, cancelResult] = await Promise.all([sending, cancellation]);
    const storedTask = await handler.getTask({ id, tenant: '' }, serverContext);

    expect((sendResult as Task).status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(artifactText(sendResult as Task)).toBe('ABC');
    expect(cancelResult.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(artifactText(cancelResult)).toBe('ABC');
    expect(storedTask.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(artifactText(storedTask)).toBe('ABC');
  });

  it('persists live append updates once when cancelTask overlaps non-blocking sendMessage', async () => {
    const { store, executor, initialSaved, cancelEntered, finish, publishChunk, publishStatus } =
      createControlledHarness();
    const handler = new DefaultRequestHandler(agentCard, store, executor);

    const initialTask = (await handler.sendMessage(
      sendReq('msg-nonblocking-cancel', true),
      serverContext
    )) as Task;
    const id = await initialSaved.promise;
    expect(initialTask.id).toBe(id);

    const cancellation = handler.cancelTask({ id, tenant: '', metadata: {} }, serverContext);
    await cancelEntered.promise;

    publishChunk('B', true);
    publishChunk('C', true);
    publishStatus(TaskState.TASK_STATE_CANCELED);
    finish.resolve();

    const cancelResult = await cancellation;
    const storedTask = await handler.getTask({ id, tenant: '' }, serverContext);

    expect(cancelResult.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(artifactText(cancelResult)).toBe('ABC');
    expect(storedTask.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(artifactText(storedTask)).toBe('ABC');
  });

  it('persists live append updates and push notifications once when cancelTask overlaps sendMessageStream', async () => {
    const { store, executor, initialSaved, cancelEntered, finish, publishChunk, publishStatus } =
      createControlledHarness();
    const pushStore = new InMemoryPushNotificationStore();
    const pushSender = new MockPushNotificationSender();
    const handler = new DefaultRequestHandler(
      agentCard,
      store,
      executor,
      new DefaultExecutionEventBusManager(),
      pushStore,
      pushSender
    );

    const streamedChunks: string[] = [];
    const req = sendReq('msg-stream-cancel');
    req.configuration = {
      acceptedOutputModes: [],
      returnImmediately: false,
      taskPushNotificationConfig: {
        id: 'push-1',
        taskId: '',
        tenant: '',
        url: 'https://example.com/push',
        token: '',
        authentication: undefined,
      },
    };

    const streaming = (async () => {
      for await (const event of handler.sendMessageStream(req, serverContext)) {
        if (event.payload?.$case === 'artifactUpdate') {
          const chunk = event.payload.value.artifact?.parts?.[0]?.content;
          if (chunk?.$case === 'text') {
            streamedChunks.push(chunk.value);
          }
        }
      }
    })();

    const id = await initialSaved.promise;
    const cancellation = handler.cancelTask({ id, tenant: '', metadata: {} }, serverContext);
    await cancelEntered.promise;

    publishChunk('B', true);
    publishChunk('C', true);
    publishStatus(TaskState.TASK_STATE_CANCELED);
    finish.resolve();

    const [, cancelResult] = await Promise.all([streaming, cancellation]);
    const storedTask = await handler.getTask({ id, tenant: '' }, serverContext);

    expect(streamedChunks.join('')).toBe('ABC');
    expect(artifactText(cancelResult)).toBe('ABC');
    expect(artifactText(storedTask)).toBe('ABC');
    // 5 published events total: Task + A + B + C + statusUpdate(CANCELED).
    expect(pushSender.send).toHaveBeenCalledTimes(5);
  });

  it('retains persistence ownership when caller explicitly closes sendMessageStream generator before cancelTask', async () => {
    const { store, executor, initialSaved, cancelEntered, finish, publishChunk, publishStatus } =
      createControlledHarness();
    const handler = new DefaultRequestHandler(agentCard, store, executor);

    let streamedTaskId = '';
    for await (const event of handler.sendMessageStream(
      sendReq('msg-stream-break-then-cancel'),
      serverContext
    )) {
      if (event.payload?.$case === 'task') {
        streamedTaskId = event.payload.value.id;
      }
      if (event.payload?.$case === 'artifactUpdate') {
        // Explicitly close the public streaming generator (`stream.return()`).
        break;
      }
    }

    const id = await initialSaved.promise;
    expect(streamedTaskId).toBe(id);

    const cancellation = handler.cancelTask({ id, tenant: '', metadata: {} }, serverContext);
    await cancelEntered.promise;

    publishChunk('B', true);
    publishChunk('C', true);
    publishStatus(TaskState.TASK_STATE_CANCELED);
    finish.resolve();

    const cancelResult = await cancellation;
    const storedTask = await handler.getTask({ id, tenant: '' }, serverContext);

    expect(cancelResult.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(artifactText(cancelResult)).toBe('ABC');
    expect(storedTask.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(artifactText(storedTask)).toBe('ABC');
  });

  it('retains persistence ownership when caller explicitly closes sendMessageStream generator without cancelTask', async () => {
    const { store, executor, initialSaved, finish, publishChunk, publishStatus } =
      createControlledHarness();
    const handler = new DefaultRequestHandler(agentCard, store, executor);

    const stream = handler.sendMessageStream(sendReq('msg-stream-early-return'), serverContext);
    const first = await stream.next();
    expect(first.done).toBe(false);
    const id = await initialSaved.promise;

    // Explicitly invoke `.return()` on the public generator while execution continues.
    await stream.return(undefined);

    publishChunk('B', true);
    publishChunk('C', true);
    publishStatus(TaskState.TASK_STATE_COMPLETED);
    finish.resolve();

    // Allow the background persistence drain to flush the terminal event.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const storedTask = await handler.getTask({ id, tenant: '' }, serverContext);
    expect(storedTask.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(artifactText(storedTask)).toBe('ABC');
  });

  it('completes cancelTask without deadlocking when sendMessageStream iterator is paused between next() calls', async () => {
    const { store, executor, initialSaved, cancelEntered, finish, publishChunk, publishStatus } =
      createControlledHarness();
    const handler = new DefaultRequestHandler(agentCard, store, executor);

    const iterator = handler
      .sendMessageStream(sendReq('msg-stream-paused-cancel'), serverContext)
      [Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBe(false);
    const id = await initialSaved.promise;

    // Iterator is paused (not calling `.next()` or `.return()`) while awaiting `cancelTask`.
    const cancellation = handler.cancelTask({ id, tenant: '', metadata: {} }, serverContext);
    await cancelEntered.promise;

    publishChunk('B', true);
    publishChunk('C', true);
    publishStatus(TaskState.TASK_STATE_CANCELED);
    finish.resolve();

    const cancelResult = await cancellation;
    expect(cancelResult.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(artifactText(cancelResult)).toBe('ABC');

    // Resuming the paused iterator still yields all buffered events in order.
    const remaining: StreamResponse[] = [];
    for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
      remaining.push(event);
    }
    const remainingChunks = remaining
      .filter((e) => e.payload?.$case === 'artifactUpdate')
      .map((e) => {
        const partContent =
          e.payload?.$case === 'artifactUpdate'
            ? e.payload.value.artifact?.parts?.[0]?.content
            : undefined;
        return partContent?.$case === 'text' ? partContent.value : '';
      })
      .join('');
    expect(remainingChunks).toBe('ABC');
  });

  it('handles concurrent cancelTask calls against a delayed TaskStore without duplicating appends or racing ahead of save', async () => {
    const { store, executor, initialSaved, cancelEntered, finish, publishChunk, publishStatus } =
      createControlledHarness(15);
    const handler = new DefaultRequestHandler(agentCard, store, executor);

    const sending = handler.sendMessage(sendReq('msg-concurrent-cancels'), serverContext);
    const id = await initialSaved.promise;

    const cancel1 = handler.cancelTask({ id, tenant: '', metadata: {} }, serverContext);
    const cancel2 = handler.cancelTask({ id, tenant: '', metadata: {} }, serverContext);
    await cancelEntered.promise;

    publishChunk('B', true);
    publishChunk('C', true);
    publishStatus(TaskState.TASK_STATE_CANCELED);
    finish.resolve();

    const [sendRes, cancelRes1, cancelRes2] = await Promise.all([sending, cancel1, cancel2]);
    expect((sendRes as Task).status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(cancelRes1.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(cancelRes2.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(artifactText(cancelRes1)).toBe('ABC');
    expect(artifactText(cancelRes2)).toBe('ABC');
  });
});

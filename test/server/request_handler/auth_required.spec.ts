import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import {
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryTaskStore,
  InMemoryPushNotificationStore,
  TaskStore,
} from '../../../src/server/index.js';
import {
  AgentCard,
  Message,
  Role,
  SendMessageRequest,
  StreamResponse,
  Task,
  TaskState,
} from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { AgentEvent } from '../../../src/server/events/execution_event_bus.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { RequestContext } from '../../../src/server/agent_execution/request_context.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';
import { MockPushNotificationSender } from '../mocks/push_notification_sender.mock.js';
import { MockTaskStore } from '../mocks/task_store.mock.js';

// AUTH_REQUIRED lifecycle through DefaultRequestHandler.
// Mirrors Python's result_aggregator._continue_consuming and Go's
// taskupdate.Final parity tests.
describe('DefaultRequestHandler AUTH_REQUIRED lifecycle (§7.6.1)', () => {
  let handler: DefaultRequestHandler;
  let taskStore: TaskStore;
  let mockExecutor: MockAgentExecutor;
  let eventBusManager: DefaultExecutionEventBusManager;
  let pushNotificationSender: MockPushNotificationSender;
  let pushNotificationStore: InMemoryPushNotificationStore;

  const agentCard: AgentCard = {
    name: 'Auth Required Agent',
    description: 'Test agent for §7.6.1 lifecycle',
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

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
    mockExecutor = new MockAgentExecutor();
    eventBusManager = new DefaultExecutionEventBusManager();
    pushNotificationStore = new InMemoryPushNotificationStore();
    pushNotificationSender = new MockPushNotificationSender();
    handler = new DefaultRequestHandler(
      agentCard,
      taskStore,
      mockExecutor,
      eventBusManager,
      pushNotificationStore,
      pushNotificationSender
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeMessage = (id: string, text: string): Message => ({
    messageId: id,
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
  });

  // Executor publishes Task + AUTH_REQUIRED then awaits release() before
  // calling onCredentials(bus). `executed` resolves when execute() returns
  // (i.e. after _settleBus). `ids` is populated once the executor enters.
  function mockAuthRequiredFlow(onCredentials: (bus: ExecutionEventBus) => void): {
    release: () => void;
    executed: Promise<void>;
    ids: { taskId: string; contextId: string };
  } {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let executedResolve!: () => void;
    const executed = new Promise<void>((resolve) => {
      executedResolve = resolve;
    });
    const ids = { taskId: '', contextId: '' };

    mockExecutor.execute.mockImplementation(async (ctx: RequestContext, bus: ExecutionEventBus) => {
      ids.taskId = ctx.taskId;
      ids.contextId = ctx.contextId;
      bus.publish(
        AgentEvent.task({
          id: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
          artifacts: [],
          history: [],
          metadata: {},
        })
      );
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_AUTH_REQUIRED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
      // Block until the test signals out-of-band credential arrival.
      await gate;
      onCredentials(bus);
      executedResolve();
    });

    return { release: releaseGate, executed, ids };
  }

  it('blocking sendMessage returns a snapshot at AUTH_REQUIRED without closing the bus', async () => {
    // Executor parks forever — release() is never called, so _settleBus
    // never runs and the bus must stay alive.
    const { ids } = mockAuthRequiredFlow(() => {
      throw new Error('post-credential code path should not run in this test');
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-auth-1', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };
    const snapshot = (await handler.sendMessage(params, serverContext)) as Task;

    expect(snapshot.id).toBe(ids.taskId);
    expect(snapshot.status.state).toBe(TaskState.TASK_STATE_AUTH_REQUIRED);

    expect(eventBusManager.getByTaskId(ids.taskId)).toBeDefined();
  });

  it('background consumer persists post-AUTH_REQUIRED events into the task store', async () => {
    const { release, executed, ids } = mockAuthRequiredFlow((bus) => {
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ids.taskId,
          contextId: ids.contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
      bus.publish(
        AgentEvent.artifactUpdate({
          taskId: ids.taskId,
          contextId: ids.contextId,
          artifact: {
            artifactId: 'artifact-after-auth',
            name: 'Result',
            description: 'Generated after credential injection',
            parts: [
              {
                content: { $case: 'text', value: 'authenticated content' },
                mediaType: 'text/plain',
                filename: '',
                metadata: undefined,
              },
            ],
            metadata: {},
            extensions: [],
          },
          append: false,
          lastChunk: true,
          metadata: {},
        })
      );
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ids.taskId,
          contextId: ids.contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-auth-2', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };
    const snapshot = (await handler.sendMessage(params, serverContext)) as Task;

    expect(snapshot.status.state).toBe(TaskState.TASK_STATE_AUTH_REQUIRED);
    expect(snapshot.artifacts ?? []).toHaveLength(0);

    release();
    await executed;
    // Yield twice so the background _processEvents promise advances past COMPLETED.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const persisted = await taskStore.load(ids.taskId, serverContext);
    expect(persisted).toBeDefined();
    expect(persisted!.contextId).toBe(ids.contextId);
    expect(persisted!.status.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(persisted!.artifacts ?? []).toHaveLength(1);
    expect(persisted!.artifacts![0].artifactId).toBe('artifact-after-auth');

    // Snapshot must not be mutated by the drain — _processEvents structuredClones.
    expect(snapshot.status.state).toBe(TaskState.TASK_STATE_AUTH_REQUIRED);
    expect(snapshot.artifacts ?? []).toHaveLength(0);
  });

  it('push notifications fire for events published after AUTH_REQUIRED', async () => {
    let observedTaskId = '';
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => (releaseGate = r));

    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      observedTaskId = ctx.taskId;
      // Register the push config now that the taskId is known.
      await pushNotificationStore.save(ctx.taskId, serverContext, {
        tenant: '',
        taskId: ctx.taskId,
        id: 'cfg-1',
        url: 'http://example.com/notify',
        token: '',
        authentication: undefined,
      });

      bus.publish(
        AgentEvent.task({
          id: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
          artifacts: [],
          history: [],
          metadata: {},
        })
      );
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_AUTH_REQUIRED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
      await gate;
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-auth-3', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    await handler.sendMessage(params, serverContext);
    const sendsBeforeRelease = pushNotificationSender.send.mock.calls.length;

    releaseGate();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const sendsAfterRelease = pushNotificationSender.send.mock.calls.length;
    expect(sendsAfterRelease).toBeGreaterThan(sendsBeforeRelease);

    const completedCalls = pushNotificationSender.send.mock.calls.filter(([response]) => {
      const r = response as StreamResponse;
      if (r.payload?.$case !== 'statusUpdate') return false;
      return r.payload.value.status?.state === TaskState.TASK_STATE_COMPLETED;
    });
    expect(completedCalls.length).toBe(1);
    expect(observedTaskId).not.toBe('');
  });

  it('bus is closed once the executor reaches a terminal state after credential injection', async () => {
    const { release, executed, ids } = mockAuthRequiredFlow((bus) => {
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ids.taskId,
          contextId: ids.contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-auth-4', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };
    const snapshot = (await handler.sendMessage(params, serverContext)) as Task;
    expect(snapshot.status.state).toBe(TaskState.TASK_STATE_AUTH_REQUIRED);
    expect(eventBusManager.getByTaskId(ids.taskId)).toBeDefined();

    release();
    await executed;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(eventBusManager.getByTaskId(ids.taskId)).toBeUndefined();
  });

  it('AUTH_REQUIRED followed by INPUT_REQUIRED in the same execution: snapshot returned at AUTH_REQUIRED, drain stops at INPUT_REQUIRED (bus stays alive)', async () => {
    const { release, executed, ids } = mockAuthRequiredFlow((bus) => {
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ids.taskId,
          contextId: ids.contextId,
          status: {
            state: TaskState.TASK_STATE_INPUT_REQUIRED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-auth-5', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };
    const snapshot = (await handler.sendMessage(params, serverContext)) as Task;
    expect(snapshot.status.state).toBe(TaskState.TASK_STATE_AUTH_REQUIRED);

    release();
    await executed;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const persisted = await taskStore.load(ids.taskId, serverContext);
    expect(persisted!.status.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    // INPUT_REQUIRED is interrupted — bus stays alive.
    expect(eventBusManager.getByTaskId(ids.taskId)).toBeDefined();
  });

  it('non-blocking sendMessage is unaffected by AUTH_REQUIRED — returns the initial Task event immediately as before', async () => {
    // The snapshot path is blocking-only; non-blocking resolves on the first Task event.
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => (releaseGate = r));

    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      bus.publish(
        AgentEvent.task({
          id: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
          artifacts: [],
          history: [],
          metadata: {},
        })
      );
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_AUTH_REQUIRED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
      await gate;
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-auth-6', 'kick off'),
      tenant: '',
      configuration: {
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        returnImmediately: true,
      },
      metadata: {},
    };

    const result = (await handler.sendMessage(params, serverContext)) as Task;
    expect(result.status.state).toBe(TaskState.TASK_STATE_SUBMITTED);

    releaseGate();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it('plain INPUT_REQUIRED flow is not affected by the new AUTH_REQUIRED handling (regression guard)', async () => {
    // authRequiredSnapshotResolver must not fire for INPUT_REQUIRED.
    let observedTaskId = '';

    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      observedTaskId = ctx.taskId;
      bus.publish(
        AgentEvent.task({
          id: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
          artifacts: [],
          history: [],
          metadata: {},
        })
      );
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_INPUT_REQUIRED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-input-1', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    const result = (await handler.sendMessage(params, serverContext)) as Task;
    expect(result.status.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);

    expect(eventBusManager.getByTaskId(observedTaskId)).toBeDefined();
  });

  it('post-AUTH_REQUIRED drain error persists a FAILED status update instead of throwing into the background', async () => {
    // Without firstResultRejector wired into blocking _processEvents,
    // _handleProcessingError would throw into the unattended drain,
    // hiding the failure and stranding the task at AUTH_REQUIRED.
    // The fix routes the error through ResultManager to persist FAILED.
    const failingStore = new MockTaskStore();
    const localBusManager = new DefaultExecutionEventBusManager();
    const localHandler = new DefaultRequestHandler(
      agentCard,
      failingStore,
      mockExecutor,
      localBusManager,
      pushNotificationStore,
      pushNotificationSender
    );

    const errorMessage = 'Simulated store failure on COMPLETED save';
    let savedFailed: Task | undefined;
    const taskByState = new Map<TaskState, Task>();
    failingStore.save.mockImplementation(async (task: Task) => {
      // Fail only on the post-snapshot publish.
      if (task.status.state === TaskState.TASK_STATE_COMPLETED) {
        throw new Error(errorMessage);
      }
      if (task.status.state === TaskState.TASK_STATE_FAILED) {
        savedFailed = task;
      }
      taskByState.set(task.status.state, task);
    });
    failingStore.load.mockImplementation(async (id: string) => {
      for (const t of [...taskByState.values()].reverse()) {
        if (t.id === id) return t;
      }
      return undefined;
    });

    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => (releaseGate = r));
    const ids = { taskId: '', contextId: '' };

    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      ids.taskId = ctx.taskId;
      ids.contextId = ctx.contextId;
      bus.publish(
        AgentEvent.task({
          id: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
          artifacts: [],
          history: [],
          metadata: {},
        })
      );
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_AUTH_REQUIRED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
      await gate;
      // Triggers the rigged store failure inside the drain.
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ctx.taskId,
          contextId: ctx.contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );
    });

    const params: SendMessageRequest = {
      message: makeMessage('msg-auth-7', 'kick off'),
      tenant: '',
      configuration: undefined,
      metadata: {},
    };

    // Snapshot resolves first; post-snapshot failure must not surface here.
    const snapshot = (await localHandler.sendMessage(params, serverContext)) as Task;
    expect(snapshot.status.state).toBe(TaskState.TASK_STATE_AUTH_REQUIRED);

    releaseGate();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(savedFailed).toBeDefined();
    expect(savedFailed!.id).toBe(ids.taskId);
    expect(savedFailed!.status.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(savedFailed!.status.message?.role).toBe(Role.ROLE_AGENT);
    expect(
      (savedFailed!.status.message?.parts[0].content as { $case: 'text'; value: string }).value
    ).toContain(errorMessage);
  });
});

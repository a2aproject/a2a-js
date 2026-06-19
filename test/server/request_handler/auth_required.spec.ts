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

/**
 * End-to-end coverage for the §7.6.1 AUTH_REQUIRED lifecycle through
 * {@link DefaultRequestHandler}:
 *   1. A blocking `sendMessage` returns a snapshot of the current Task
 *      as soon as the executor publishes AUTH_REQUIRED, without
 *      closing the underlying event bus.
 *   2. The handler continues to drain events the executor publishes
 *      after the snapshot was returned, persisting them into the
 *      `TaskStore` via the same `ResultManager` and firing push
 *      notifications.
 *   3. The bus is closed once the executor finally returns at a
 *      terminal state (i.e. `_settleBus` runs with a non-interrupted
 *      `lastState`).
 *
 * Mirrors the Python `result_aggregator._continue_consuming` and Go
 * `taskupdate.Final` parity tests.
 */
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

  /**
   * Configures `mockExecutor` to publish a Task + AUTH_REQUIRED
   * status update, then await an external trigger before invoking
   * `onCredentials(bus)`. Captures the taskId/contextId the handler
   * assigns to the in-flight request so individual tests can assert
   * against them.
   *
   * Returns:
   *   * `release()`: invoke from the test to simulate the
   *     out-of-band credential arrival.
   *   * `executed`: resolves once `execute()` has returned. Tests use
   *     this to know when `.finally(_settleBus)` has run.
   *   * `ids`: live container, populated once the executor enters.
   */
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
      // Block until the test signals that the credential has
      // arrived out-of-band.
      await gate;
      onCredentials(bus);
      executedResolve();
    });

    return { release: releaseGate, executed, ids };
  }

  it('blocking sendMessage returns a snapshot at AUTH_REQUIRED without closing the bus', async () => {
    // Executor parks indefinitely on the credential — `release` is
    // never called inside this test, so `_settleBus` is never reached
    // and the bus must stay alive.
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

    // Bus must still be alive — `_settleBus` was not called because
    // the executor has not returned.
    expect(eventBusManager.getByTaskId(ids.taskId)).toBeDefined();
  });

  it('background consumer persists post-AUTH_REQUIRED events into the task store', async () => {
    const { release, executed, ids } = mockAuthRequiredFlow((bus) => {
      // Credential injected — resume publishing.
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

    // Caller got the snapshot at AUTH_REQUIRED and nothing more
    // (artifact / completion events have not been published yet).
    expect(snapshot.status.state).toBe(TaskState.TASK_STATE_AUTH_REQUIRED);
    expect(snapshot.artifacts ?? []).toHaveLength(0);

    // Release the agent and let the background drain catch up.
    release();
    await executed;
    // Yield so the background `_processEvents` promise can advance to
    // and past the COMPLETED status.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // The store reflects what the background consumer drained.
    const persisted = await taskStore.load(ids.taskId, serverContext);
    expect(persisted).toBeDefined();
    expect(persisted!.contextId).toBe(ids.contextId);
    expect(persisted!.status.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(persisted!.artifacts ?? []).toHaveLength(1);
    expect(persisted!.artifacts![0].artifactId).toBe('artifact-after-auth');

    // Snapshot returned to the caller MUST NOT have been mutated by
    // the background drain — `_processEvents` deep-clones via
    // `structuredClone` before resolving the snapshot.
    expect(snapshot.status.state).toBe(TaskState.TASK_STATE_AUTH_REQUIRED);
    expect(snapshot.artifacts ?? []).toHaveLength(0);
  });

  it('push notifications fire for events published after AUTH_REQUIRED', async () => {
    // Register a push config for the task BEFORE the message is sent
    // — `sendMessage` doesn't know the taskId up front, but we can
    // intercept the executor to grab it and register on the fly.
    let observedTaskId = '';
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => (releaseGate = r));

    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      observedTaskId = ctx.taskId;
      // Register a push config now that we know the taskId. The
      // sender mock captures every push call regardless of config.
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
    // Snapshot of which sends fired pre-credential.
    const sendsBeforeRelease = pushNotificationSender.send.mock.calls.length;

    releaseGate();
    // Let the background drain process the COMPLETED status.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const sendsAfterRelease = pushNotificationSender.send.mock.calls.length;
    expect(sendsAfterRelease).toBeGreaterThan(sendsBeforeRelease);

    // Find the COMPLETED status update among the calls fired after
    // the AUTH_REQUIRED snapshot was returned.
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
    // Bus stays alive while the executor is paused on the credential.
    expect(eventBusManager.getByTaskId(ids.taskId)).toBeDefined();

    release();
    await executed;
    // The executor returns after the COMPLETED publish; its `.finally`
    // calls `_settleBus`, which closes the bus and cleans up.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(eventBusManager.getByTaskId(ids.taskId)).toBeUndefined();
  });

  it('AUTH_REQUIRED followed by INPUT_REQUIRED in the same execution: snapshot returned at AUTH_REQUIRED, drain stops at INPUT_REQUIRED (bus stays alive)', async () => {
    const { release, executed, ids } = mockAuthRequiredFlow((bus) => {
      // After the credential, the agent decides it needs additional
      // input from the client. The drain loop must observe and
      // persist this, then stop. The bus stays alive (interrupted
      // state) for the follow-up `message/send`.
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
    // INPUT_REQUIRED is an interrupted state — bus stays alive for
    // the follow-up `message/send` (existing §3.4.3 semantics).
    expect(eventBusManager.getByTaskId(ids.taskId)).toBeDefined();
  });

  it('non-blocking sendMessage is unaffected by AUTH_REQUIRED — returns the initial Task event immediately as before', async () => {
    // The §7.6.1 snapshot path only applies to blocking calls. The
    // non-blocking path resolves on the first Task event regardless
    // of subsequent state transitions; this test pins that contract.
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
    // Non-blocking resolves on the FIRST Task event — that's still
    // SUBMITTED, not the AUTH_REQUIRED snapshot the blocking path
    // would have returned.
    expect(result.status.state).toBe(TaskState.TASK_STATE_SUBMITTED);

    releaseGate();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it('plain INPUT_REQUIRED flow is not affected by the new AUTH_REQUIRED handling (regression guard)', async () => {
    // The new `authRequiredSnapshotResolver` callback must NOT fire
    // for INPUT_REQUIRED — only the existing terminal-state code
    // path should run, and the queue must stop normally.
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

    // Bus stays alive for the follow-up `message/send` (§3.4.3) —
    // same pre-existing behaviour.
    expect(eventBusManager.getByTaskId(observedTaskId)).toBeDefined();
  });

  it('post-AUTH_REQUIRED drain error persists a FAILED status update instead of throwing into the background', async () => {
    // The caller already has the AUTH_REQUIRED snapshot when the
    // drain throws. Without `firstResultRejector` wired into the
    // blocking-mode `_processEvents` call, `_handleProcessingError`
    // would fall into its "blocking case" branch and `throw error`
    // inside the unattended background drain — which makes the
    // failure invisible to the client AND leaves the task stuck at
    // AUTH_REQUIRED in the store. With the fix, `firstResultSent` is
    // set alongside the snapshot resolve and `firstResultRejector`
    // is passed in, routing the error into the "first result already
    // sent" branch which persists a FAILED status via `ResultManager`.
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
      // Inject the failure only on the post-snapshot publish so the
      // snapshot return path itself is unaffected.
      if (task.status.state === TaskState.TASK_STATE_COMPLETED) {
        throw new Error(errorMessage);
      }
      if (task.status.state === TaskState.TASK_STATE_FAILED) {
        savedFailed = task;
      }
      taskByState.set(task.status.state, task);
    });
    failingStore.load.mockImplementation(async (id: string) => {
      // Returns the most recently saved version of the task,
      // regardless of state — used by `ResultManager.ensureTaskLoaded`
      // and by the handler's task-event-to-stream-response mapping.
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
      // This publish will trigger the rigged store failure inside
      // the drain loop after the snapshot has already been returned.
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

    // The blocking call resolves with the snapshot — the
    // post-snapshot failure must not surface here.
    const snapshot = (await localHandler.sendMessage(params, serverContext)) as Task;
    expect(snapshot.status.state).toBe(TaskState.TASK_STATE_AUTH_REQUIRED);

    releaseGate();
    // Let the background drain advance through the throwing publish
    // and the recovery path that saves the FAILED status.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // The FAILED status must have been persisted via the
    // "first result already sent" recovery branch.
    expect(savedFailed).toBeDefined();
    expect(savedFailed!.id).toBe(ids.taskId);
    expect(savedFailed!.status.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(savedFailed!.status.message?.role).toBe(Role.ROLE_AGENT);
    expect(
      (savedFailed!.status.message?.parts[0].content as { $case: 'text'; value: string }).value
    ).toContain(errorMessage);
  });
});

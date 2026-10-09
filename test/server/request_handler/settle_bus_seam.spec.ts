import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { DefaultRequestHandler, InMemoryTaskStore, TaskStore } from '../../../src/server/index.js';
import {
  AgentCard,
  Message,
  Role,
  SendMessageRequest,
  Task,
  TaskState,
} from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { AgentEvent, ExecutionEventBus } from '../../../src/server/events/execution_event_bus.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

interface SettleCall {
  taskId: string;
  eventBus: ExecutionEventBus;
  lastObservedState: TaskState | undefined;
}

/**
 * Bus manager that takes ownership of every bus and then does nothing with it
 * — the shape a database-backed bus uses when its own reader loop decides when
 * the task is really finished.
 */
class DeferringBusManager extends DefaultExecutionEventBusManager {
  public readonly settleCalls: SettleCall[] = [];

  settleByTaskId(
    taskId: string,
    eventBus: ExecutionEventBus,
    lastObservedState: TaskState | undefined
  ): boolean {
    this.settleCalls.push({ taskId, eventBus, lastObservedState });
    return true;
  }
}

/**
 * Bus manager that is offered every decision and declines all of them, so the
 * handler's default policy applies exactly as if the method were absent.
 */
class DecliningBusManager extends DefaultExecutionEventBusManager {
  public readonly settleCalls: SettleCall[] = [];

  settleByTaskId(
    taskId: string,
    eventBus: ExecutionEventBus,
    lastObservedState: TaskState | undefined
  ): boolean {
    this.settleCalls.push({ taskId, eventBus, lastObservedState });
    return false;
  }
}

// `settleByTaskId` lets a bus manager take over the teardown decision that
// `_settleBus` otherwise makes from the last state seen on the bus. Buses that
// defer delivery cannot be settled that way: nothing has been observed by the
// time the executor returns.
describe('DefaultRequestHandler bus settle seam (ExecutionEventBusManager.settleByTaskId)', () => {
  let taskStore: TaskStore;
  let mockExecutor: MockAgentExecutor;

  const agentCard: AgentCard = {
    name: 'Settle Seam Agent',
    description: 'Test agent for ExecutionEventBusManager.settleByTaskId',
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

  const makeParams = (messageId: string): SendMessageRequest => ({
    message: makeMessage(messageId, 'kick off'),
    tenant: '',
    configuration: undefined,
    metadata: {},
  });

  const publishTask = (
    bus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    state: TaskState
  ) =>
    bus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: { state, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      })
    );

  const publishStatus = (
    bus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    state: TaskState
  ) =>
    bus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state, message: undefined, timestamp: undefined },
        metadata: {},
      })
    );

  /** Lets the executor's `.finally()` (and therefore `_settleBus`) run. */
  const flushSettle = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  const makeHandler = (
    eventBusManager: DefaultExecutionEventBusManager,
    keepBusAliveStates?: TaskState[]
  ) =>
    new DefaultRequestHandler(
      agentCard,
      taskStore,
      mockExecutor,
      eventBusManager,
      undefined,
      undefined,
      undefined,
      undefined,
      keepBusAliveStates ? { keepBusAliveStates } : {}
    );

  // A manager without the optional method must behave exactly as before the
  // seam existed. These three pin the fallback path.
  describe('manager without settleByTaskId (default policy retained)', () => {
    it('tears the bus down after a terminal state', async () => {
      const eventBusManager = new DefaultExecutionEventBusManager();
      let observedTaskId = '';
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED);
        publishStatus(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_COMPLETED);
      });

      await makeHandler(eventBusManager).sendMessage(makeParams('msg-fallback-1'), serverContext);
      await flushSettle();

      expect(eventBusManager.getByTaskId(observedTaskId)).toBeUndefined();
    });

    it('keeps the bus alive for the default INPUT_REQUIRED state', async () => {
      const eventBusManager = new DefaultExecutionEventBusManager();
      let observedTaskId = '';
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED);
        publishStatus(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_INPUT_REQUIRED);
      });

      await makeHandler(eventBusManager).sendMessage(makeParams('msg-fallback-2'), serverContext);
      await flushSettle();

      expect(eventBusManager.getByTaskId(observedTaskId)).toBeDefined();
    });

    it('honors a custom keepBusAliveStates list', async () => {
      const eventBusManager = new DefaultExecutionEventBusManager();
      let observedTaskId = '';
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED);
        publishStatus(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_COMPLETED);
      });

      const handler = makeHandler(eventBusManager, [TaskState.TASK_STATE_COMPLETED]);
      await handler.sendMessage(makeParams('msg-fallback-3'), serverContext);
      await flushSettle();

      expect(eventBusManager.getByTaskId(observedTaskId)).toBeDefined();
    });
  });

  describe('manager that takes ownership (settleByTaskId returns true)', () => {
    it('is offered the decision from the sendMessage path, and the handler then does nothing', async () => {
      const eventBusManager = new DeferringBusManager();
      const cleanupSpy = vi.spyOn(eventBusManager, 'cleanupByTaskId');
      let observedTaskId = '';
      let finishedSpy: ReturnType<typeof vi.spyOn> | undefined;

      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        finishedSpy = vi.spyOn(bus, 'finished');
        publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED);
        publishStatus(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_COMPLETED);
      });

      await makeHandler(eventBusManager).sendMessage(makeParams('msg-seam-1'), serverContext);
      await flushSettle();

      expect(eventBusManager.settleCalls).toHaveLength(1);
      const call = eventBusManager.settleCalls[0];
      expect(call.taskId).toBe(observedTaskId);
      expect(call.eventBus).toBe(eventBusManager.getByTaskId(observedTaskId));
      expect(call.lastObservedState).toBe(TaskState.TASK_STATE_COMPLETED);

      // Ownership taken: the handler must not finish or clean up itself.
      expect(finishedSpy).toBeDefined();
      expect(finishedSpy!).not.toHaveBeenCalled();
      expect(cleanupSpy).not.toHaveBeenCalled();
      expect(eventBusManager.getByTaskId(observedTaskId)).toBeDefined();
    });

    it('delegates from the sendMessageStream path too', async () => {
      const eventBusManager = new DeferringBusManager();
      const cleanupSpy = vi.spyOn(eventBusManager, 'cleanupByTaskId');
      let observedTaskId = '';

      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED);
        publishStatus(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_COMPLETED);
      });

      const handler = makeHandler(eventBusManager);
      for await (const _event of handler.sendMessageStream(
        makeParams('msg-seam-2'),
        serverContext
      )) {
        void _event;
      }
      await flushSettle();

      expect(eventBusManager.settleCalls).toHaveLength(1);
      expect(eventBusManager.settleCalls[0].taskId).toBe(observedTaskId);
      expect(eventBusManager.settleCalls[0].lastObservedState).toBe(TaskState.TASK_STATE_COMPLETED);
      expect(cleanupSpy).not.toHaveBeenCalled();
      expect(eventBusManager.getByTaskId(observedTaskId)).toBeDefined();
    });

    it('receives undefined when nothing was observed, and never settling leaves the caller pending', async () => {
      // An executor that published nothing is indistinguishable, through this
      // argument, from a bus that has not delivered yet — which is exactly why
      // the seam exists. It is also the documented hazard: an owner that never
      // settles such a bus leaves a blocking sendMessage hanging.
      const eventBusManager = new DeferringBusManager();
      let observedTaskId = '';
      mockExecutor.execute.mockImplementation(async (ctx) => {
        observedTaskId = ctx.taskId;
      });

      const handler = makeHandler(eventBusManager);
      // Track settlement without awaiting, and swallow the eventual rejection
      // so it cannot leak out of this test as an unhandled rejection.
      const settled = handler
        .sendMessage(makeParams('msg-seam-3'), serverContext)
        .then(() => 'resolved' as const)
        .catch(() => 'rejected' as const);

      await flushSettle();
      expect(eventBusManager.settleCalls).toHaveLength(1);
      expect(eventBusManager.settleCalls[0].lastObservedState).toBeUndefined();

      const outcome = await Promise.race([
        settled,
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
      ]);
      expect(outcome).toBe('pending');

      // Release the drain so the suite leaves nothing dangling.
      eventBusManager.getByTaskId(observedTaskId)!.finished();
      await expect(settled).resolves.toBe('rejected');
    });

    it('overrides keepBusAliveStates for that call', async () => {
      // COMPLETED is deliberately NOT in the keep-alive list, so the default
      // policy would tear the bus down here. Taking ownership must win.
      const eventBusManager = new DeferringBusManager();
      let observedTaskId = '';
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED);
        publishStatus(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_COMPLETED);
      });

      const handler = makeHandler(eventBusManager, [TaskState.TASK_STATE_INPUT_REQUIRED]);
      await handler.sendMessage(makeParams('msg-seam-4'), serverContext);
      await flushSettle();

      expect(eventBusManager.settleCalls).toHaveLength(1);
      expect(eventBusManager.getByTaskId(observedTaskId)).toBeDefined();
    });

    it('an owner can still settle immediately by calling finished() and cleanupByTaskId()', async () => {
      // Taking ownership does not forfeit the default outcome — it just moves
      // who decides. This is the shape a reader loop uses once its drain is
      // done.
      class EagerBusManager extends DefaultExecutionEventBusManager {
        public settleCount = 0;

        settleByTaskId(taskId: string, eventBus: ExecutionEventBus): boolean {
          this.settleCount += 1;
          eventBus.finished();
          this.cleanupByTaskId(taskId);
          return true;
        }
      }

      const eventBusManager = new EagerBusManager();
      let observedTaskId = '';
      // INPUT_REQUIRED would be kept alive by the fallback path, so a torn-down
      // bus here can only be this manager's doing.
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED);
        publishStatus(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_INPUT_REQUIRED);
      });

      await makeHandler(eventBusManager).sendMessage(makeParams('msg-seam-5'), serverContext);
      await flushSettle();

      expect(eventBusManager.settleCount).toBe(1);
      expect(eventBusManager.getByTaskId(observedTaskId)).toBeUndefined();
    });
  });

  // Declining is what lets a manager intervene only where it needs to, instead
  // of reimplementing the state policy for every task it does not care about.
  describe('manager that declines (settleByTaskId returns false)', () => {
    it('gets the default teardown for a terminal state', async () => {
      const eventBusManager = new DecliningBusManager();
      let observedTaskId = '';
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED);
        publishStatus(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_COMPLETED);
      });

      await makeHandler(eventBusManager).sendMessage(makeParams('msg-decline-1'), serverContext);
      await flushSettle();

      expect(eventBusManager.settleCalls).toHaveLength(1);
      expect(eventBusManager.getByTaskId(observedTaskId)).toBeUndefined();
    });

    it('still gets keepBusAliveStates applied', async () => {
      const eventBusManager = new DecliningBusManager();
      let observedTaskId = '';
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        observedTaskId = ctx.taskId;
        publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED);
        publishStatus(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_COMPLETED);
      });

      const handler = makeHandler(eventBusManager, [TaskState.TASK_STATE_COMPLETED]);
      await handler.sendMessage(makeParams('msg-decline-2'), serverContext);
      await flushSettle();

      expect(eventBusManager.settleCalls).toHaveLength(1);
      expect(eventBusManager.getByTaskId(observedTaskId)).toBeDefined();
    });

    it('can own one task and decline another', async () => {
      // Per-call, not per-manager: the distinction a static "I handle my own
      // settling" flag could not express.
      class SelectiveBusManager extends DefaultExecutionEventBusManager {
        public readonly owned: string[] = [];

        settleByTaskId(taskId: string): boolean {
          const take = this.owned.length === 0;
          if (take) this.owned.push(taskId);
          return take;
        }
      }

      const eventBusManager = new SelectiveBusManager();
      const seen: string[] = [];
      mockExecutor.execute.mockImplementation(async (ctx, bus) => {
        seen.push(ctx.taskId);
        publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED);
        publishStatus(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_COMPLETED);
      });

      const handler = makeHandler(eventBusManager);
      await handler.sendMessage(makeParams('msg-selective-1'), serverContext);
      await flushSettle();
      await handler.sendMessage(makeParams('msg-selective-2'), serverContext);
      await flushSettle();

      expect(seen).toHaveLength(2);
      // First was claimed, so its bus survives; second was declined and torn
      // down by the default policy.
      expect(eventBusManager.getByTaskId(seen[0])).toBeDefined();
      expect(eventBusManager.getByTaskId(seen[1])).toBeUndefined();
    });
  });

  it('a blocking sendMessage still resolves when the terminal event arrives after a deferred settle', async () => {
    const eventBusManager = new DeferringBusManager();
    let observedTaskId = '';
    let observedContextId = '';
    mockExecutor.execute.mockImplementation(async (ctx, bus) => {
      observedTaskId = ctx.taskId;
      observedContextId = ctx.contextId;
      publishTask(bus, ctx.taskId, ctx.contextId, TaskState.TASK_STATE_WORKING);
    });

    const handler = makeHandler(eventBusManager);
    const pending = handler.sendMessage(makeParams('msg-seam-late'), serverContext);

    await flushSettle();
    expect(eventBusManager.settleCalls).toHaveLength(1);

    const bus = eventBusManager.getByTaskId(observedTaskId);
    expect(bus).toBeDefined();
    publishStatus(bus!, observedTaskId, observedContextId, TaskState.TASK_STATE_COMPLETED);

    const result = (await pending) as Task;
    expect(result.id).toBe(observedTaskId);
    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

    const stored = await taskStore.load(observedTaskId, serverContext);
    expect(stored?.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
  });
});

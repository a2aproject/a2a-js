import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  ResultManager,
  TaskStore,
} from '../../../src/server/index.js';
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

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flushSettle = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe('DefaultRequestHandler stale interrupted Task / statusUpdate bus settlement (#817)', () => {
  let taskStore: TaskStore;
  let mockExecutor: MockAgentExecutor;
  let eventBusManager: DefaultExecutionEventBusManager;
  let handler: DefaultRequestHandler;

  const agentCard: AgentCard = {
    name: 'Stale Interrupted Bus Test Agent',
    description: 'Tests event bus settlement when stale interrupted events race terminal tasks',
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

  const makeMessage = (id: string, text: string, overrides: Partial<Message> = {}): Message => ({
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
    ...overrides,
  });

  const makeTask = (
    id: string,
    contextId: string,
    state: TaskState,
    overrides: Partial<Task> = {}
  ): Task => ({
    id,
    contextId,
    status: { state, message: undefined, timestamp: undefined },
    artifacts: [],
    history: [],
    metadata: {},
    ...overrides,
  });

  it.each([
    ['INPUT_REQUIRED', TaskState.TASK_STATE_INPUT_REQUIRED],
    ['AUTH_REQUIRED', TaskState.TASK_STATE_AUTH_REQUIRED],
  ])(
    'releases the streaming event bus when a stale %s Task snapshot races a CANCELED transition',
    async (_label, staleState) => {
      const taskId = `task-stream-stale-snapshot-${staleState}`;
      const contextId = `ctx-stream-stale-snapshot-${staleState}`;
      await taskStore.save(
        makeTask(taskId, contextId, TaskState.TASK_STATE_WORKING),
        serverContext
      );

      const entered = createDeferred();
      const gate = createDeferred();
      const cleanupSpy = vi.spyOn(eventBusManager, 'cleanupByTaskId');
      let finishedSpy: ReturnType<typeof vi.spyOn> | undefined;

      mockExecutor.execute.mockImplementation(async (_ctx, bus) => {
        finishedSpy = vi.spyOn(bus, 'finished');
        entered.resolve();
        await gate.promise;
        bus.publish(AgentEvent.task(makeTask(taskId, contextId, staleState)));
      });

      const stream = handler.sendMessageStream(
        {
          message: makeMessage(`msg-${taskId}`, 'continue', { taskId, contextId }),
          tenant: '',
          configuration: undefined,
          metadata: {},
        },
        serverContext
      );

      const firstChunk = stream.next();
      await entered.promise;

      await new ResultManager(taskStore, serverContext).processEvent(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_CANCELED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );

      gate.resolve();
      const first = await firstChunk;
      if (!first.value || first.value.payload?.$case !== 'task') {
        throw new Error('Expected task event');
      }
      expect(first.value.payload.value.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
      await stream.return(undefined);
      await flushSettle();

      expect((await taskStore.load(taskId, serverContext))?.status?.state).toBe(
        TaskState.TASK_STATE_CANCELED
      );
      expect(eventBusManager.getByTaskId(taskId, serverContext)).toBeUndefined();
      expect(finishedSpy).toHaveBeenCalledTimes(1);
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['INPUT_REQUIRED', TaskState.TASK_STATE_INPUT_REQUIRED],
    ['AUTH_REQUIRED', TaskState.TASK_STATE_AUTH_REQUIRED],
  ])(
    'releases the streaming event bus when a stale %s statusUpdate races a CANCELED transition',
    async (_label, staleState) => {
      const taskId = `task-stream-stale-status-${staleState}`;
      const contextId = `ctx-stream-stale-status-${staleState}`;
      await taskStore.save(
        makeTask(taskId, contextId, TaskState.TASK_STATE_WORKING),
        serverContext
      );

      const entered = createDeferred();
      const gate = createDeferred();
      const cleanupSpy = vi.spyOn(eventBusManager, 'cleanupByTaskId');
      let finishedSpy: ReturnType<typeof vi.spyOn> | undefined;

      mockExecutor.execute.mockImplementation(async (_ctx, bus) => {
        finishedSpy = vi.spyOn(bus, 'finished');
        bus.publish(AgentEvent.task(makeTask(taskId, contextId, TaskState.TASK_STATE_WORKING)));
        entered.resolve();
        await gate.promise;
        bus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: { state: staleState, message: undefined, timestamp: undefined },
            metadata: {},
          })
        );
      });

      const stream = handler.sendMessageStream(
        {
          message: makeMessage(`msg-${taskId}`, 'continue', { taskId, contextId }),
          tenant: '',
          configuration: undefined,
          metadata: {},
        },
        serverContext
      );

      await stream.next();
      await entered.promise;

      await new ResultManager(taskStore, serverContext).processEvent(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_CANCELED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );

      const secondChunk = stream.next();
      gate.resolve();
      await secondChunk;
      await stream.return(undefined);
      await flushSettle();

      expect((await taskStore.load(taskId, serverContext))?.status?.state).toBe(
        TaskState.TASK_STATE_CANCELED
      );
      expect(eventBusManager.getByTaskId(taskId, serverContext)).toBeUndefined();
      expect(finishedSpy).toHaveBeenCalledTimes(1);
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['INPUT_REQUIRED', TaskState.TASK_STATE_INPUT_REQUIRED],
    ['AUTH_REQUIRED', TaskState.TASK_STATE_AUTH_REQUIRED],
  ])(
    'releases the sendMessage event bus and resolves blocking sendMessage when a stale %s Task snapshot races CANCELED',
    async (_label, staleState) => {
      const taskId = `task-send-stale-snapshot-${staleState}`;
      const contextId = `ctx-send-stale-snapshot-${staleState}`;
      await taskStore.save(
        makeTask(taskId, contextId, TaskState.TASK_STATE_WORKING),
        serverContext
      );

      const entered = createDeferred();
      const gate = createDeferred();

      mockExecutor.execute.mockImplementation(async (_ctx, bus) => {
        entered.resolve();
        await gate.promise;
        bus.publish(AgentEvent.task(makeTask(taskId, contextId, staleState)));
      });

      const pending = handler.sendMessage(
        {
          message: makeMessage(`msg-${taskId}`, 'continue', { taskId, contextId }),
          tenant: '',
          configuration: undefined,
          metadata: {},
        } satisfies SendMessageRequest,
        serverContext
      );

      await entered.promise;
      await new ResultManager(taskStore, serverContext).processEvent(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_CANCELED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        })
      );

      gate.resolve();
      const result = (await pending) as Task;
      await flushSettle();

      expect(result.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
      expect((await taskStore.load(taskId, serverContext))?.status?.state).toBe(
        TaskState.TASK_STATE_CANCELED
      );
      expect(eventBusManager.getByTaskId(taskId, serverContext)).toBeUndefined();
    }
  );

  it('preserves custom settleByTaskId ownership when settleByTaskId returns true on a stale interrupted snapshot', async () => {
    class OwningBusManager extends DefaultExecutionEventBusManager {
      public readonly calls: Array<{ taskId: string; lastObservedState: TaskState | undefined }> =
        [];

      settleByTaskId(
        taskId: string,
        _eventBus: ExecutionEventBus,
        lastObservedState: TaskState | undefined
      ): boolean {
        this.calls.push({ taskId, lastObservedState });
        return true;
      }
    }

    const customManager = new OwningBusManager();
    const cleanupSpy = vi.spyOn(customManager, 'cleanupByTaskId');
    const customHandler = new DefaultRequestHandler(
      agentCard,
      taskStore,
      mockExecutor,
      customManager
    );

    const taskId = 'task-custom-owning';
    const contextId = 'ctx-custom-owning';
    await taskStore.save(makeTask(taskId, contextId, TaskState.TASK_STATE_WORKING), serverContext);

    const entered = createDeferred();
    const gate = createDeferred();
    let finishedSpy: ReturnType<typeof vi.spyOn> | undefined;

    mockExecutor.execute.mockImplementation(async (_ctx, bus) => {
      finishedSpy = vi.spyOn(bus, 'finished');
      entered.resolve();
      await gate.promise;
      bus.publish(
        AgentEvent.task(makeTask(taskId, contextId, TaskState.TASK_STATE_INPUT_REQUIRED))
      );
    });

    const stream = customHandler.sendMessageStream(
      {
        message: makeMessage('msg-custom-owning', 'continue', { taskId, contextId }),
        tenant: '',
        configuration: undefined,
        metadata: {},
      },
      serverContext
    );

    const first = stream.next();
    await entered.promise;
    await new ResultManager(taskStore, serverContext).processEvent(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_CANCELED, message: undefined, timestamp: undefined },
        metadata: {},
      })
    );

    gate.resolve();
    await first;
    await stream.return(undefined);
    await flushSettle();

    expect(customManager.calls).toEqual([
      { taskId, lastObservedState: TaskState.TASK_STATE_INPUT_REQUIRED },
    ]);
    expect(finishedSpy).not.toHaveBeenCalled();
    expect(cleanupSpy).not.toHaveBeenCalled();
    expect(customManager.getByTaskId(taskId, serverContext)).toBeDefined();

    // Clean up test bus
    customManager.getByTaskId(taskId, serverContext)?.finished();
    customManager.cleanupByTaskId(taskId, serverContext);
  });

  it('invokes settleByTaskId only once and settles once when settleByTaskId declines (returns false) on a stale interrupted snapshot', async () => {
    class DecliningBusManager extends DefaultExecutionEventBusManager {
      public readonly calls: Array<{ taskId: string; lastObservedState: TaskState | undefined }> =
        [];

      settleByTaskId(
        taskId: string,
        _eventBus: ExecutionEventBus,
        lastObservedState: TaskState | undefined
      ): boolean {
        this.calls.push({ taskId, lastObservedState });
        return false;
      }
    }

    const customManager = new DecliningBusManager();
    const cleanupSpy = vi.spyOn(customManager, 'cleanupByTaskId');
    const customHandler = new DefaultRequestHandler(
      agentCard,
      taskStore,
      mockExecutor,
      customManager
    );

    const taskId = 'task-custom-declining';
    const contextId = 'ctx-custom-declining';
    await taskStore.save(makeTask(taskId, contextId, TaskState.TASK_STATE_WORKING), serverContext);

    const entered = createDeferred();
    const gate = createDeferred();
    let finishedSpy: ReturnType<typeof vi.spyOn> | undefined;

    mockExecutor.execute.mockImplementation(async (_ctx, bus) => {
      finishedSpy = vi.spyOn(bus, 'finished');
      entered.resolve();
      await gate.promise;
      bus.publish(AgentEvent.task(makeTask(taskId, contextId, TaskState.TASK_STATE_AUTH_REQUIRED)));
    });

    const stream = customHandler.sendMessageStream(
      {
        message: makeMessage('msg-custom-declining', 'continue', { taskId, contextId }),
        tenant: '',
        configuration: undefined,
        metadata: {},
      },
      serverContext
    );

    const first = stream.next();
    await entered.promise;
    await new ResultManager(taskStore, serverContext).processEvent(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_CANCELED, message: undefined, timestamp: undefined },
        metadata: {},
      })
    );

    gate.resolve();
    await first;
    await stream.return(undefined);
    await flushSettle();

    expect(customManager.calls).toEqual([
      { taskId, lastObservedState: TaskState.TASK_STATE_AUTH_REQUIRED },
    ]);
    expect(finishedSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(customManager.getByTaskId(taskId, serverContext)).toBeUndefined();
  });

  it('does not tear down a shared bus if a follow-up executor turn starts while reconciliation is awaiting TaskStore', async () => {
    const contextId = 'ctx-overlapping-followup';
    let sharedTaskId = '';

    let blockReconcileLoad = false;
    const unblockLoad = createDeferred();
    const loadBlocked = createDeferred();
    const origSave = taskStore.save.bind(taskStore);
    const origLoad = taskStore.load.bind(taskStore);
    vi.spyOn(taskStore, 'save').mockImplementation(async (task, ctx) => {
      await origSave(task, ctx);
      if (task.status?.state === TaskState.TASK_STATE_INPUT_REQUIRED) {
        blockReconcileLoad = true;
      }
    });
    vi.spyOn(taskStore, 'load').mockImplementation(async (id, ctx) => {
      if (blockReconcileLoad && id === sharedTaskId) {
        blockReconcileLoad = false;
        loadBlocked.resolve();
        await unblockLoad.promise;
      }
      return origLoad(id, ctx);
    });

    // Turn 1: publishes INPUT_REQUIRED; save() arms blockReconcileLoad for reconciliation's load()
    mockExecutor.execute.mockImplementationOnce(async (ctx, bus) => {
      sharedTaskId = ctx.taskId;
      bus.publish(
        AgentEvent.task(makeTask(ctx.taskId, ctx.contextId, TaskState.TASK_STATE_SUBMITTED))
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

    const firstTurn = (await handler.sendMessage(
      {
        message: makeMessage('msg-turn-1', 'first', { contextId }),
        tenant: '',
        configuration: undefined,
        metadata: {},
      },
      serverContext
    )) as Task;
    expect(firstTurn.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    const sharedBus = eventBusManager.getByTaskId(sharedTaskId, serverContext);
    expect(sharedBus).toBeDefined();

    await loadBlocked.promise;

    // Turn 2 starts on the same task & bus and transitions to WORKING while Turn 1's load is still pending
    const turn2Entered = createDeferred();
    const finishTurn2 = createDeferred();
    mockExecutor.execute.mockImplementationOnce(async (ctx, bus) => {
      expect(bus).toBe(sharedBus);
      bus.publish(
        AgentEvent.statusUpdate({
          taskId: ctx.taskId,
          contextId: ctx.contextId,
          status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
          metadata: {},
        })
      );
      turn2Entered.resolve();
      await finishTurn2.promise;
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

    const secondTurnPromise = handler.sendMessage(
      {
        message: makeMessage('msg-turn-2', 'second', { taskId: sharedTaskId, contextId }),
        tenant: '',
        configuration: undefined,
        metadata: {},
      },
      serverContext
    );

    await turn2Entered.promise;
    await flushSettle();

    // Unblock Turn 1's reconciliation load (which now sees WORKING from Turn 2!)
    unblockLoad.resolve();
    await flushSettle();

    // Bus MUST still be alive while Turn 2's executor is running
    expect(eventBusManager.getByTaskId(sharedTaskId, serverContext)).toBe(sharedBus);

    finishTurn2.resolve();
    const secondTurn = (await secondTurnPromise) as Task;
    await flushSettle();

    expect(secondTurn.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(eventBusManager.getByTaskId(sharedTaskId, serverContext)).toBeUndefined();
  });
});

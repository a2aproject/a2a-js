import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DefaultRequestHandler } from '../../src/server/index.js';
import { AgentEvent, ExecutionEventBus } from '../../src/server/events/execution_event_bus.js';
import { DefaultExecutionEventBusManager } from '../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../src/server/context.js';
import { RequestContext } from '../../src/server/agent_execution/request_context.js';
import { AgentExecutor } from '../../src/server/agent_execution/agent_executor.js';
import { Role, Task, TaskState } from '../../src/types/pb/a2a.js';
import { DeferredSettleBusManager, DelayingTaskStore, waitFor } from './support/delaying.js';
import { agentCard, drain, lastState, makeParams } from './support/fixtures.js';

const STORE_DELAY_MS = 25;
const BUS_DELAY_MS = 60;

/** Publishes a Task, an agent Message into history, then completes. */
class ChattyExecutor implements AgentExecutor {
  public taskId = '';
  public contextId = '';

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    this.taskId = ctx.taskId;
    this.contextId = ctx.contextId;

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
          state: TaskState.TASK_STATE_WORKING,
          message: {
            messageId: `agent-${ctx.taskId}`,
            role: Role.ROLE_AGENT,
            parts: [
              {
                content: { $case: 'text', value: 'working on it' },
                mediaType: 'text/plain',
                filename: '',
                metadata: undefined,
              },
            ],
            taskId: ctx.taskId,
            contextId: ctx.contextId,
            extensions: [],
            metadata: {},
            referenceTaskIds: [],
          },
          timestamp: undefined,
        },
        metadata: {},
      })
    );

    bus.publish(
      AgentEvent.artifactUpdate({
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        artifact: {
          artifactId: `artifact-${ctx.taskId}`,
          name: 'result',
          description: '',
          parts: [
            {
              content: { $case: 'text', value: 'the answer' },
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
  }

  async cancelTask(): Promise<void> {}
}

// A database-backed TaskStore has latency on every read and write. These cover
// the latency dimension only: the store still deep-copies on load and save, as
// the built-in one does.
describe('delayed task store', () => {
  let taskStore: DelayingTaskStore;
  let busManager: DefaultExecutionEventBusManager;
  const serverContext = new ServerCallContext();

  beforeEach(() => {
    taskStore = new DelayingTaskStore(STORE_DELAY_MS);
    busManager = new DefaultExecutionEventBusManager();
  });

  const makeHandler = (executor: AgentExecutor) =>
    new DefaultRequestHandler(agentCard, taskStore, executor, busManager);

  it('blocking sendMessage completes and persists the full task', async () => {
    const executor = new ChattyExecutor();
    const result = (await makeHandler(executor).sendMessage(
      makeParams('delayed-store-blocking'),
      serverContext
    )) as Task;

    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

    const stored = await taskStore.load(result.id, serverContext);
    expect(stored?.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(stored?.artifacts).toHaveLength(1);
    // The user turn plus the agent's WORKING message.
    expect(stored?.history?.length).toBeGreaterThanOrEqual(2);
  });

  it('sendMessageStream completes against a slow store', async () => {
    const executor = new ChattyExecutor();
    const events = await drain(
      makeHandler(executor).sendMessageStream(makeParams('delayed-store-stream'), serverContext)
    );

    expect(lastState(events)).toBe(TaskState.TASK_STATE_COMPLETED);
    const stored = await taskStore.load(executor.taskId, serverContext);
    expect(stored?.artifacts).toHaveLength(1);
  });

  it('getTask returns the persisted history after completion', async () => {
    const executor = new ChattyExecutor();
    const handler = makeHandler(executor);
    const result = (await handler.sendMessage(
      makeParams('delayed-store-gettask'),
      serverContext
    )) as Task;

    const fetched = await handler.getTask({ id: result.id, tenant: '' }, serverContext);
    expect(fetched.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(fetched.history?.length).toBeGreaterThanOrEqual(2);
  });

  it('two sequential turns on the same task accumulate history', async () => {
    // Second turn re-reads through the slow store before merging, so a
    // read-modify-write that lost the race would drop the first turn.
    class PausingExecutor implements AgentExecutor {
      public taskId = '';
      public turn = 0;

      async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
        this.taskId = ctx.taskId;
        this.turn += 1;
        const terminal =
          this.turn === 1 ? TaskState.TASK_STATE_INPUT_REQUIRED : TaskState.TASK_STATE_COMPLETED;
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
        bus.publish(
          AgentEvent.statusUpdate({
            taskId: ctx.taskId,
            contextId: ctx.contextId,
            status: { state: terminal, message: undefined, timestamp: undefined },
            metadata: {},
          })
        );
      }

      async cancelTask(): Promise<void> {}
    }

    const executor = new PausingExecutor();
    const handler = makeHandler(executor);

    const first = (await handler.sendMessage(
      makeParams('delayed-store-turn-1', 'first'),
      serverContext
    )) as Task;
    expect(first.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);

    const followUp = makeParams('delayed-store-turn-2', 'second');
    followUp.message!.taskId = first.id;
    followUp.message!.contextId = first.contextId;
    const second = (await handler.sendMessage(followUp, serverContext)) as Task;

    expect(second.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    const texts = (second.history ?? []).flatMap((message) =>
      message.parts.map((part) => (part.content?.$case === 'text' ? part.content.value : ''))
    );
    expect(texts).toContain('first');
    expect(texts).toContain('second');
  });

  describe('combined with a delayed event bus', () => {
    let deferredManager: DeferredSettleBusManager;

    beforeEach(() => {
      deferredManager = new DeferredSettleBusManager(BUS_DELAY_MS);
    });

    afterEach(() => {
      deferredManager.disposeAll();
    });

    it('completes when both the store and the bus are slow', async () => {
      const executor = new ChattyExecutor();
      const handler = new DefaultRequestHandler(agentCard, taskStore, executor, deferredManager);

      const result = (await handler.sendMessage(
        makeParams('delayed-store-and-bus'),
        serverContext
      )) as Task;

      expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
      await waitFor(
        () => deferredManager.getByTaskId(executor.taskId) === undefined,
        'the manager to release the bus'
      );
    });
  });

  // The cases below need a store that hands back live references rather than
  // deep copies. They fail today: the SDK mutates store-returned objects in
  // place, which is only safe because InMemoryTaskStore clones. Tracked as
  // Tier 1 of the custom-integration audit, out of scope for the settle seam.
  describe('non-cloning task store (Tier 1 — not yet supported)', () => {
    it.todo(
      'getTask with historyLength 0 must not truncate the stored history (default_request_handler.ts _applyHistoryLengthSemantics on the loaded task)'
    );
    it.todo('listTasks with historyLength must not truncate stored histories for the same reason');
    it.todo(
      'a streaming push-notification payload must not be retro-mutated by later history trimming (clone asymmetry between _processEvents and sendMessageStream)'
    );
    it.todo(
      'a custom OwnerResolver must still serialize concurrent writes (result_manager.ts lockKey hardcodes context.user?.userName)'
    );
  });
});

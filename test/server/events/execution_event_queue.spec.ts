import { describe, it, expect, beforeEach } from 'vitest';

import {
  DefaultExecutionEventBus,
  AgentEvent,
  AgentExecutionEvent,
} from '../../../src/server/events/execution_event_bus.js';
import { ExecutionEventQueue } from '../../../src/server/events/execution_event_queue.js';
import { Message, Role, Task, TaskStatusUpdateEvent } from '../../../src/index.js';
import { TaskState } from '../../../src/types/pb/a2a.js';

/**
 * Tests for `ExecutionEventQueue.events()` focused on the stop-set
 * semantics introduced for spec §7.6.1 AUTH_REQUIRED handling.
 *
 * The queue must stop iterating on:
 *   * Message,
 *   * any terminal state,
 *   * INPUT_REQUIRED.
 *
 * The queue must KEEP iterating past:
 *   * AUTH_REQUIRED (executor resumes after out-of-band credential),
 *   * intermediate non-terminal states (SUBMITTED / WORKING / etc.).
 */
describe('ExecutionEventQueue stop semantics', () => {
  let bus: DefaultExecutionEventBus;

  beforeEach(() => {
    bus = new DefaultExecutionEventBus();
  });

  const taskId = 'task-eq-1';
  const contextId = 'ctx-eq-1';

  const statusEvent = (state: TaskState): AgentExecutionEvent =>
    AgentEvent.statusUpdate({
      taskId,
      contextId,
      status: { state, message: undefined, timestamp: undefined },
      metadata: {},
    } as TaskStatusUpdateEvent);

  const taskEvent: AgentExecutionEvent = AgentEvent.task({
    id: taskId,
    contextId,
    status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
    artifacts: [],
    history: [],
    metadata: {},
  } as Task);

  const messageEvent: AgentExecutionEvent = AgentEvent.message({
    messageId: 'msg-1',
    role: Role.ROLE_AGENT,
    parts: [
      {
        content: { $case: 'text', value: 'hi' },
        filename: '',
        mediaType: 'text/plain',
        metadata: {},
      },
    ],
    taskId,
    contextId,
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  } as Message);

  /**
   * Helper that drives the queue until it stops on its own, returning
   * the full list of yielded events. Publishes happen via the bus
   * before the iteration starts so they're already buffered when
   * `events()` first awaits.
   */
  async function drain(queue: ExecutionEventQueue): Promise<AgentExecutionEvent[]> {
    const seen: AgentExecutionEvent[] = [];
    for await (const event of queue.events()) {
      seen.push(event);
    }
    return seen;
  }

  it('stops after a Message event', async () => {
    const queue = new ExecutionEventQueue(bus);
    bus.publish(taskEvent);
    bus.publish(messageEvent);
    // Subsequent events would not be yielded after a Message; publish
    // one to prove it.
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));

    const seen = await drain(queue);
    expect(seen).toHaveLength(2);
    expect(seen[1].kind).toBe('message');
  });

  it('stops on terminal COMPLETED status', async () => {
    const queue = new ExecutionEventQueue(bus);
    bus.publish(taskEvent);
    bus.publish(statusEvent(TaskState.TASK_STATE_COMPLETED));
    // Anything after a terminal should be ignored.
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));

    const seen = await drain(queue);
    expect(seen).toHaveLength(2);
    expect(seen[1].kind).toBe('statusUpdate');
    expect((seen[1].data as TaskStatusUpdateEvent).status?.state).toBe(
      TaskState.TASK_STATE_COMPLETED
    );
  });

  it.each([
    ['FAILED', TaskState.TASK_STATE_FAILED],
    ['CANCELED', TaskState.TASK_STATE_CANCELED],
    ['REJECTED', TaskState.TASK_STATE_REJECTED],
  ])('stops on terminal %s status', async (_name, state) => {
    const queue = new ExecutionEventQueue(bus);
    bus.publish(taskEvent);
    bus.publish(statusEvent(state));
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));

    const seen = await drain(queue);
    expect(seen).toHaveLength(2);
    expect((seen[1].data as TaskStatusUpdateEvent).status?.state).toBe(state);
  });

  it('stops on INPUT_REQUIRED (executor is paused waiting on follow-up message)', async () => {
    const queue = new ExecutionEventQueue(bus);
    bus.publish(taskEvent);
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));
    bus.publish(statusEvent(TaskState.TASK_STATE_INPUT_REQUIRED));
    // Anything published after INPUT_REQUIRED on this queue should be
    // ignored — a fresh queue (attached to the same bus) is the only
    // path forward.
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));

    const seen = await drain(queue);
    expect(seen).toHaveLength(3);
    expect((seen[2].data as TaskStatusUpdateEvent).status?.state).toBe(
      TaskState.TASK_STATE_INPUT_REQUIRED
    );
  });

  it('does NOT stop on AUTH_REQUIRED — keeps draining for the post-credential publishes (§7.6.1)', async () => {
    const queue = new ExecutionEventQueue(bus);
    bus.publish(taskEvent);
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));
    bus.publish(statusEvent(TaskState.TASK_STATE_AUTH_REQUIRED));
    // Simulate the agent resuming after out-of-band credential
    // injection — these events MUST flow through the same queue.
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));
    bus.publish(statusEvent(TaskState.TASK_STATE_COMPLETED));

    const seen = await drain(queue);
    expect(seen).toHaveLength(5);
    expect((seen[2].data as TaskStatusUpdateEvent).status?.state).toBe(
      TaskState.TASK_STATE_AUTH_REQUIRED
    );
    expect((seen[3].data as TaskStatusUpdateEvent).status?.state).toBe(
      TaskState.TASK_STATE_WORKING
    );
    expect((seen[4].data as TaskStatusUpdateEvent).status?.state).toBe(
      TaskState.TASK_STATE_COMPLETED
    );
  });

  it('AUTH_REQUIRED followed by INPUT_REQUIRED stops on INPUT_REQUIRED', async () => {
    // Sanity: even though AUTH_REQUIRED is not in the stop set, the
    // queue still treats a subsequent INPUT_REQUIRED as the natural
    // pause point.
    const queue = new ExecutionEventQueue(bus);
    bus.publish(taskEvent);
    bus.publish(statusEvent(TaskState.TASK_STATE_AUTH_REQUIRED));
    bus.publish(statusEvent(TaskState.TASK_STATE_INPUT_REQUIRED));
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));

    const seen = await drain(queue);
    expect(seen).toHaveLength(3);
    expect((seen[2].data as TaskStatusUpdateEvent).status?.state).toBe(
      TaskState.TASK_STATE_INPUT_REQUIRED
    );
  });

  it('AUTH_REQUIRED followed by a terminal state stops on the terminal state', async () => {
    const queue = new ExecutionEventQueue(bus);
    bus.publish(taskEvent);
    bus.publish(statusEvent(TaskState.TASK_STATE_AUTH_REQUIRED));
    bus.publish(statusEvent(TaskState.TASK_STATE_COMPLETED));

    const seen = await drain(queue);
    expect(seen).toHaveLength(3);
    expect((seen[2].data as TaskStatusUpdateEvent).status?.state).toBe(
      TaskState.TASK_STATE_COMPLETED
    );
  });

  it('does not stop on intermediate non-terminal states (SUBMITTED, WORKING)', async () => {
    const queue = new ExecutionEventQueue(bus);
    bus.publish(taskEvent);
    bus.publish(statusEvent(TaskState.TASK_STATE_SUBMITTED));
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));
    bus.publish(statusEvent(TaskState.TASK_STATE_COMPLETED));

    const seen = await drain(queue);
    expect(seen).toHaveLength(4);
  });

  it('stops when the bus emits finished (executor-driven shutdown)', async () => {
    const queue = new ExecutionEventQueue(bus);
    bus.publish(taskEvent);
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));
    bus.finished();

    const seen = await drain(queue);
    expect(seen).toHaveLength(2);
  });

  it('keeps draining past AUTH_REQUIRED even when events arrive asynchronously', async () => {
    // Exercise the async resolvePromise path: queue starts iterating
    // before all events are published, then events are pushed one by
    // one with a microtask gap between them.
    const queue = new ExecutionEventQueue(bus);
    const collected: AgentExecutionEvent[] = [];

    const drainPromise = (async () => {
      for await (const e of queue.events()) {
        collected.push(e);
      }
    })();

    // Yield to let the consumer attach to the bus.
    bus.publish(taskEvent);
    await Promise.resolve();
    bus.publish(statusEvent(TaskState.TASK_STATE_AUTH_REQUIRED));
    await Promise.resolve();
    // The executor resumes on the same bus after credential injection.
    bus.publish(statusEvent(TaskState.TASK_STATE_WORKING));
    await Promise.resolve();
    bus.publish(statusEvent(TaskState.TASK_STATE_COMPLETED));

    await drainPromise;

    expect(collected).toHaveLength(4);
    expect((collected[1].data as TaskStatusUpdateEvent).status?.state).toBe(
      TaskState.TASK_STATE_AUTH_REQUIRED
    );
    expect((collected[3].data as TaskStatusUpdateEvent).status?.state).toBe(
      TaskState.TASK_STATE_COMPLETED
    );
  });
});

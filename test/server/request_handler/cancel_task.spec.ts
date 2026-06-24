import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import {
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryTaskStore,
  TaskStore,
} from '../../../src/server/index.js';
import { AgentCard, CancelTaskRequest, Task, TaskState } from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { AgentEvent } from '../../../src/server/events/execution_event_bus.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { TaskNotCancelableError, TaskNotFoundError } from '../../../src/errors.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

/**
 * Focused coverage for {@link DefaultRequestHandler.cancelTask} per
 * spec §3.1.5 (output is the "Updated Task with cancellation status";
 * "success is not guaranteed (e.g., the task might have already
 * completed or failed, or cancellation might not be supported at its
 * current stage)") and §3.3.1 (cancel MUST be idempotent — "multiple
 * cancellation requests have the same effect").
 *
 * Mirrors the a2a-go idempotent pattern in
 * `a2asrv/agentexec.go:268,357-359` and
 * `internal/taskexec/distributed_manager.go:164-166`.
 *
 * The contract verified here:
 *
 *   1. **Idempotent on CANCELED** — a second cancel of an
 *      already-canceled task returns the snapshot, NOT
 *      `TaskNotCancelableError` (§3.3.1).
 *   2. **Non-blocking** — the handler MUST NOT await an event drain
 *      after `agentExecutor.cancelTask(...)`. Returning the current
 *      snapshot satisfies §3.1.5's "Updated Task with cancellation
 *      status" output without blocking on the executor publishing a
 *      CANCELED event.
 *   3. **Non-CANCELED final state is not an error** — §3.1.5 explicitly
 *      lists "the task might have already completed or failed" as a
 *      reason cancel may not succeed; that outcome is the snapshot, not
 *      a thrown error.
 *   4. **Non-cancelable states still throw** — COMPLETED / FAILED /
 *      REJECTED tasks raise `TaskNotCancelableError` per the §3.1.5
 *      errors list.
 *   5. **Unknown task still throws `TaskNotFoundError`** — preserved
 *      per the §3.1.5 errors list.
 */
describe('DefaultRequestHandler.cancelTask (§3.1.5, §3.3.1)', () => {
  let handler: DefaultRequestHandler;
  let taskStore: TaskStore;
  let mockExecutor: MockAgentExecutor;
  let eventBusManager: DefaultExecutionEventBusManager;

  const agentCard: AgentCard = {
    name: 'Cancel Task Agent',
    description: 'Test agent for §3.1.5 / §3.3.1 cancel contract',
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

  const makeTask = (
    id: string,
    state: TaskState = TaskState.TASK_STATE_WORKING,
    contextId = `ctx-${id}`
  ): Task => ({
    id,
    contextId,
    status: { state, message: undefined, timestamp: undefined },
    artifacts: [],
    history: [],
    metadata: {},
  });

  const cancelReq = (id: string): CancelTaskRequest => ({
    id,
    tenant: '',
    metadata: {},
  });

  it('returns the snapshot (no throw) when canceling an already-canceled task — §3.3.1 idempotency', async () => {
    // The user retries cancel after the first one succeeded (or two
    // clients raced the same cancel). Per §3.3.1 the second call MUST
    // be idempotent — return the snapshot, not TaskNotCancelableError.
    const taskId = 'task-double-cancel';
    const persisted = makeTask(taskId, TaskState.TASK_STATE_CANCELED);
    await taskStore.save(persisted, serverContext);

    const result = await handler.cancelTask(cancelReq(taskId), serverContext);

    expect(result.id).toBe(taskId);
    expect(result.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    // The executor must not be re-signaled for a task that's already
    // canceled — idempotency means a no-op, not a re-issue.
    expect(mockExecutor.cancelTask).not.toHaveBeenCalled();
  });

  it('returns the current snapshot without awaiting a CANCELED event — §3.1.5 non-blocking', async () => {
    // Executor's cancelTask is a no-op stub that resolves immediately
    // without publishing CANCELED. Previously, cancelTask awaited
    // `_processEvents`, which only resolves once the bus closes — so
    // this call would never return. The handler must now fire the
    // signal and return the current snapshot from the store; §3.1.5
    // defines the output as "Updated Task with cancellation status",
    // i.e. whatever the current state is at response time.
    const taskId = 'task-no-cancel-event';
    const contextId = `ctx-${taskId}`;
    const persisted = makeTask(taskId, TaskState.TASK_STATE_WORKING, contextId);
    await taskStore.save(persisted, serverContext);

    // Register an active bus so the handler takes the executor-signal
    // branch (not the no-bus direct-persist branch).
    eventBusManager.createOrGetByTaskId(taskId);

    // If the handler awaited the event drain this `await` would never
    // resolve — the test would time out instead of asserting. Reaching
    // the assertions at all is the proof of non-blocking behavior.
    const result = await handler.cancelTask(cancelReq(taskId), serverContext);

    expect(mockExecutor.cancelTask).toHaveBeenCalledExactlyOnceWith(taskId, expect.anything());
    // Snapshot reflects the persisted state — the executor hasn't
    // published anything in response to cancel, so it remains WORKING.
    expect(result.status?.state).toBe(TaskState.TASK_STATE_WORKING);
  });

  it('returns the snapshot when the executor completes during cancel — no post-load throw', async () => {
    // §3.1.5 explicitly names "the task might have already completed or
    // failed" as a reason cancel may not succeed. Race: the user signals
    // cancel, but the executor was already on the last step and
    // publishes COMPLETED before processing the cancel. The previous
    // implementation threw TaskNotCancelableError after the drain
    // because final state was not CANCELED; the new contract returns
    // the snapshot — the "Updated Task with cancellation status"
    // §3.1.5 specifies as the output.
    const taskId = 'task-natural-completion';
    const contextId = `ctx-${taskId}`;
    const persisted = makeTask(taskId, TaskState.TASK_STATE_WORKING, contextId);
    await taskStore.save(persisted, serverContext);

    const bus: ExecutionEventBus = eventBusManager.createOrGetByTaskId(taskId);

    // Simulate the completion landing while the cancel call is in
    // flight: the executor publishes COMPLETED inside its cancelTask
    // handler (a reasonable response when work already finished), and
    // we persist that state to the store so the post-signal
    // `taskStore.load(...)` observes COMPLETED.
    mockExecutor.cancelTask.mockImplementation(
      async (cancelTaskId: string, eventBus: ExecutionEventBus) => {
        eventBus.publish(
          AgentEvent.statusUpdate({
            taskId: cancelTaskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_COMPLETED,
              message: undefined,
              timestamp: undefined,
            },
            metadata: {},
          })
        );
        // Persist directly — the handler no longer drains the bus, so
        // a parallel ResultManager isn't writing this state for us in
        // the test's deterministic window.
        const current = await taskStore.load(cancelTaskId, serverContext);
        if (current) {
          current.status = {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: undefined,
          };
          await taskStore.save(current, serverContext);
        }
      }
    );

    const result = await handler.cancelTask(cancelReq(taskId), serverContext);

    expect(result.id).toBe(taskId);
    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    // Bus is still around — `_runExecutor.finally` is what closes it,
    // not cancelTask. Referenced so the no-unused-vars lint is happy.
    expect(bus).toBeDefined();
  });

  it('throws TaskNotCancelableError for COMPLETED tasks', async () => {
    const taskId = 'task-completed';
    await taskStore.save(makeTask(taskId, TaskState.TASK_STATE_COMPLETED), serverContext);
    await expect(handler.cancelTask(cancelReq(taskId), serverContext)).rejects.toThrow(
      TaskNotCancelableError
    );
    expect(mockExecutor.cancelTask).not.toHaveBeenCalled();
  });

  it('throws TaskNotCancelableError for FAILED tasks', async () => {
    const taskId = 'task-failed';
    await taskStore.save(makeTask(taskId, TaskState.TASK_STATE_FAILED), serverContext);
    await expect(handler.cancelTask(cancelReq(taskId), serverContext)).rejects.toThrow(
      TaskNotCancelableError
    );
    expect(mockExecutor.cancelTask).not.toHaveBeenCalled();
  });

  it('throws TaskNotCancelableError for REJECTED tasks', async () => {
    const taskId = 'task-rejected';
    await taskStore.save(makeTask(taskId, TaskState.TASK_STATE_REJECTED), serverContext);
    await expect(handler.cancelTask(cancelReq(taskId), serverContext)).rejects.toThrow(
      TaskNotCancelableError
    );
    expect(mockExecutor.cancelTask).not.toHaveBeenCalled();
  });

  it('still throws TaskNotFoundError when the task id is unknown', async () => {
    await expect(handler.cancelTask(cancelReq('does-not-exist'), serverContext)).rejects.toThrow(
      TaskNotFoundError
    );
    expect(mockExecutor.cancelTask).not.toHaveBeenCalled();
  });

  it('persists CANCELED state directly when no active bus exists', async () => {
    // No-bus branch is unchanged: the executor isn't around to signal,
    // so the handler writes CANCELED to the store and returns it. Pinned
    // as a regression guard so the new idempotency check doesn't
    // accidentally short-circuit the persist path.
    const taskId = 'task-no-bus';
    const persisted = makeTask(taskId, TaskState.TASK_STATE_WORKING);
    await taskStore.save(persisted, serverContext);
    expect(eventBusManager.getByTaskId(taskId)).toBeUndefined();

    const result = await handler.cancelTask(cancelReq(taskId), serverContext);

    expect(result.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    // No executor signal on the no-bus branch — there's nothing
    // running to interrupt.
    expect(mockExecutor.cancelTask).not.toHaveBeenCalled();
    // The cancellation message should be appended to history.
    expect(result.history?.length).toBeGreaterThan(0);
  });
});

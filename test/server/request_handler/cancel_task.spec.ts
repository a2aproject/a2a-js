import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { DefaultRequestHandler, InMemoryTaskStore, TaskStore } from '../../../src/server/index.js';
import { AgentCard, CancelTaskRequest, Task, TaskState } from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

/**
 * Focused coverage for the §3.3.1 idempotency carve-out in
 * {@link DefaultRequestHandler.cancelTask}: "Cancel Task operations
 * are idempotent — multiple cancellation requests have the same effect."
 *
 * The rest of the cancel contract (terminal-state rejection, unknown
 * task, drain-then-return) is already covered in
 * `default_request_handler.spec.ts`.
 */
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
});

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { DefaultRequestHandler, InMemoryTaskStore, TaskStore } from '../../../src/server/index.js';
import { AgentCard, CancelTaskRequest, Task, TaskState } from '../../../src/types/pb/a2a.js';
import { DefaultExecutionEventBusManager } from '../../../src/server/events/execution_event_bus_manager.js';
import { ServerCallContext } from '../../../src/server/context.js';
import { MockAgentExecutor } from '../mocks/agent-executor.mock.js';

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

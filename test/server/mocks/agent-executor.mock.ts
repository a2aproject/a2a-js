import { vi, type Mock, type MockInstance } from 'vitest';
import { AgentExecutor } from '../../../src/server/agent_execution/agent_executor.js';
import { TaskState } from '../../../src/types/pb/a2a.js';
import { RequestContext } from '../../../src/server/agent_execution/request_context.js';
import { ExecutionEventBus } from '../../../src/server/events/execution_event_bus.js';

/**
 * A mock implementation of AgentExecutor to control agent behavior during tests.
 */
export class MockAgentExecutor implements AgentExecutor {
  // Stubs to control and inspect calls to execute and cancelTask
  public execute: Mock<
    (requestContext: RequestContext, eventBus: ExecutionEventBus) => Promise<void>
  > = vi.fn();

  public cancelTask: Mock<(taskId: string, eventBus: ExecutionEventBus) => Promise<void>> = vi.fn();
}

/**
 * Fake implementation of the task execution events.
 */
export const fakeTaskExecute = async (ctx: RequestContext, bus: ExecutionEventBus) => {
  const taskId = ctx.taskId;
  const contextId = ctx.contextId;

  // Publish task creation
  bus.publish({
    id: taskId,
    contextId,
    status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
    artifacts: [],
    history: [],
    metadata: {},
  });

  // Publish working status
  bus.publish({
    taskId,
    contextId,
    status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
    metadata: {},
  });

  // Publish completion
  bus.publish({
    taskId,
    contextId,
    status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
    metadata: {},
  });

  bus.finished();
};

/**
 * A realistic mock of AgentExecutor for cancellation tests.
 */
export class CancellableMockAgentExecutor implements AgentExecutor {
  private cancelledTasks = new Set<string>();
  public cancelTaskSpy: MockInstance;

  constructor() {
    this.cancelTaskSpy = vi.spyOn(this as CancellableMockAgentExecutor, 'cancelTask');
  }

  public async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    eventBus.publish({
      id: taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
      artifacts: [],
      history: [],
      metadata: {},
    });
    eventBus.publish({
      taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
      metadata: {},
    });

    // Simulate a long-running process
    for (let i = 0; i < 5; i++) {
      // We can't easily advance timers in a tight loop without yielding, but for test purposes
      // checking the cancelledTasks set is enough if the test calls cancelTask.
      if (this.cancelledTasks.has(taskId)) {
        eventBus.publish({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_CANCELED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        });
        eventBus.finished();
        return;
      }
      // Use fake timers to simulate work
      // In real code we'd need to yield or wait for timer.
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    eventBus.publish({
      taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
      metadata: {},
    });
    eventBus.finished();
  }

  public async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    this.cancelledTasks.add(taskId);
    // The execute loop is responsible for publishing the final state
  }
}

/**
 * A realistic mock of AgentExecutor for failed cancellation tests.
 */
export class FailingCancellableMockAgentExecutor implements AgentExecutor {
  private cancelledTasks = new Set<string>();
  public cancelTaskSpy: MockInstance;

  constructor() {
    this.cancelTaskSpy = vi.spyOn(this as FailingCancellableMockAgentExecutor, 'cancelTask');
  }

  public async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    eventBus.publish({
      id: taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
      artifacts: [],
      history: [],
      metadata: {},
    });
    eventBus.publish({
      taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
      metadata: {},
    });

    // Simulate a long-running process
    for (let i = 0; i < 5; i++) {
      if (this.cancelledTasks.has(taskId)) {
        eventBus.publish({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_CANCELED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: {},
        });
        eventBus.finished();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    eventBus.publish({
      taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
      metadata: {},
    });
    eventBus.finished();
  }

  public async cancelTask(_taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    // No operation: simulates the failure of task cancellation
  }
}

import { vi, type Mock, type MockInstance } from 'vitest';
import { AgentExecutor } from '../../../src/server/agent_execution/agent_executor.js';
import { TaskState } from '../../../src/types/pb/a2a.js';
import { RequestContext } from '../../../src/server/agent_execution/request_context.js';
import { ExecutionEventBus, AgentEvent } from '../../../src/server/events/execution_event_bus.js';

export class MockAgentExecutor implements AgentExecutor {
  public execute: Mock<
    (requestContext: RequestContext, eventBus: ExecutionEventBus) => Promise<void>
  > = vi.fn();

  public cancelTask: Mock<(taskId: string, eventBus: ExecutionEventBus) => Promise<void>> = vi.fn();
}

export const fakeTaskExecute = async (ctx: RequestContext, bus: ExecutionEventBus) => {
  const taskId = ctx.taskId;
  const contextId = ctx.contextId;

  bus.publish(
    AgentEvent.task({
      id: taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
      artifacts: [],
      history: [],
      metadata: {},
    })
  );

  bus.publish(
    AgentEvent.statusUpdate({
      taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
      metadata: {},
    })
  );

  bus.publish(
    AgentEvent.statusUpdate({
      taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
      metadata: {},
    })
  );

  bus.finished();
};

export class CancellableMockAgentExecutor implements AgentExecutor {
  private cancelledTasks = new Set<string>();
  public cancelTaskSpy: MockInstance;

  constructor() {
    this.cancelTaskSpy = vi.spyOn(this as CancellableMockAgentExecutor, 'cancelTask');
  }

  public async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      })
    );
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
      })
    );

    for (let i = 0; i < 5; i++) {
      if (this.cancelledTasks.has(taskId)) {
        eventBus.publish(
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
        eventBus.finished();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
        metadata: {},
      })
    );
    eventBus.finished();
  }

  public async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    this.cancelledTasks.add(taskId);
    // execute() publishes the final cancellation status.
  }
}

export class FailingCancellableMockAgentExecutor implements AgentExecutor {
  private cancelledTasks = new Set<string>();
  public cancelTaskSpy: MockInstance;

  constructor() {
    this.cancelTaskSpy = vi.spyOn(this as FailingCancellableMockAgentExecutor, 'cancelTask');
  }

  public async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      })
    );
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
      })
    );

    for (let i = 0; i < 5; i++) {
      if (this.cancelledTasks.has(taskId)) {
        eventBus.publish(
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
        eventBus.finished();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
        metadata: {},
      })
    );
    eventBus.finished();
  }

  public async cancelTask(_taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    // No-op: simulates a cancellation that never publishes.
  }
}

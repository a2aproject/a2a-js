import { v4 as uuidv4 } from 'uuid';

import { Task, TaskState, TaskStatusUpdateEvent, Role } from '../../../index.js';
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  AgentEvent,
} from '../../../server/index.js';

/**
 * CancellableAgentExecutor demonstrates how to implement user-initiated task
 * cancellation in an A2A agent.
 *
 * The pattern is:
 *
 *   1. `cancelTask(taskId, eventBus)` is invoked by the runtime when the
 *      client calls `client.cancelTask({ id: taskId })` (the SDK's invocation
 *      of the A2A "Cancel Task" operation, exposed as `CancelTask` over
 *      JSON-RPC and `POST /tasks/{id}:cancel` over HTTP+JSON/REST). We record
 *      the taskId in an in-memory Set.
 *   2. `execute(...)` runs a multi-step loop. Before each step it checks
 *      whether the taskId has been marked for cancellation.
 *   3. On cancellation, the executor publishes a final
 *      `TaskState.TASK_STATE_CANCELED` status update and returns.
 *   4. A `try/finally` block in `execute(...)` always removes the taskId
 *      from the Set on return — completion, cancellation, or thrown error —
 *      so the Set does not grow unbounded.
 *
 * See A2A Specification §3.1.5 (Cancel Task) for the operation contract:
 * https://a2a-protocol.org/latest/specification/#315-cancel-task
 * and §9.4.5 (`CancelTask`) for the JSON-RPC binding:
 * https://a2a-protocol.org/latest/specification/#945-canceltask.
 */
export class CancellableAgentExecutor implements AgentExecutor {
  private readonly cancelledTasks = new Set<string>();

  public cancelTask = async (taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {
    console.log(`[CancellableAgentExecutor] Cancellation requested for task ${taskId}`);
    this.cancelledTasks.add(taskId);
  };

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(`[CancellableAgentExecutor] Starting task ${taskId} (context: ${contextId})`);

    try {
      // 1. Publish initial Task event if it's a new task.
      if (!existingTask) {
        const initialTask: Task = {
          id: taskId,
          contextId: contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            timestamp: new Date().toISOString(),
            message: undefined,
          },
          artifacts: [],
          history: [userMessage],
          metadata: userMessage.metadata,
        };
        eventBus.publish(AgentEvent.task(initialTask));
      }

      // 2. Move into the working state.
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            timestamp: new Date().toISOString(),
            message: undefined,
          },
          metadata: {},
        })
      );

      // 3. Multi-step work, with a cancellation check before every step.
      const totalSteps = 5;
      for (let step = 1; step <= totalSteps; step++) {
        if (this.cancelledTasks.has(taskId)) {
          console.log(`[CancellableAgentExecutor] Aborting task ${taskId} at step ${step}.`);

          const cancelledUpdate: TaskStatusUpdateEvent = {
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_CANCELED,
              timestamp: new Date().toISOString(),
              message: {
                role: Role.ROLE_AGENT,
                messageId: uuidv4(),
                parts: [
                  {
                    content: {
                      $case: 'text',
                      value: `Task cancelled by user at step ${step}/${totalSteps}.`,
                    },
                    metadata: undefined,
                    filename: '',
                    mediaType: 'text/plain',
                  },
                ],
                taskId,
                contextId,
                extensions: [],
                metadata: {},
                referenceTaskIds: [],
              },
            },
            metadata: {},
          };
          eventBus.publish(AgentEvent.statusUpdate(cancelledUpdate));
          return;
        }

        console.log(`[CancellableAgentExecutor] Task ${taskId}: step ${step}/${totalSteps}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // 4. If we reach this point, no cancellation was requested.
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            timestamp: new Date().toISOString(),
            message: undefined,
          },
          metadata: {},
        })
      );

      console.log(`[CancellableAgentExecutor] Task ${taskId} completed.`);
    } finally {
      this.cancelledTasks.delete(taskId);
    }
  }
}

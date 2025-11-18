import { ExecutionEventBus } from '../events/execution_event_bus.js';
import { RequestContext } from './request_context.js';

export interface AgentExecutor {
  /**
   * Executes the agent logic based on the request context and publishes events.
   * @param requestContext The context of the current request.
   * @param eventBus The bus to publish execution events to.
   */
  execute: (requestContext: RequestContext, eventBus: ExecutionEventBus) => Promise<void>;

  /**
   * Method to explicitly cancel a running task.
   * The implementation should handle the logic of stopping the execution
   * and publishing the final 'canceled' status event on the provided event bus.
   * @param taskId The ID of the task to cancel.
   * @param eventBus The event bus associated with the task's execution.
   */
  cancelTask: (taskId: string, eventBus: ExecutionEventBus) => Promise<void>;
}

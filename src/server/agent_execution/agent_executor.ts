import { ExecutionEventBus } from '../events/execution_event_bus.js';
import { RequestContext } from './request_context.js';

export interface AgentExecutor {
  /**
   * Executes the agent logic and publishes events to the bus.
   *
   * Multi-tenant implementations can read the tenant identifier from
   * `requestContext.context.tenant`.
   */
  execute: (requestContext: RequestContext, eventBus: ExecutionEventBus) => Promise<void>;

  /**
   * Cancels a running task. The implementation should stop execution and
   * publish a final `canceled` status event on the provided bus.
   */
  cancelTask: (taskId: string, eventBus: ExecutionEventBus) => Promise<void>;
}

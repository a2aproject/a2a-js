import type { PluginManager } from '../../plugins/types.js';
import type { AgentExecutionEvent, ExecutionEventBus } from '../events/execution_event_bus.js';
import type { AgentExecutor } from './agent_executor.js';
import type { RequestContext } from './request_context.js';

/**
 * Wraps `executor` so `execute` runs the plugin execution hooks:
 * `beforeExecution`, then `execute` inside `aroundExecution`, then
 * `afterExecution` with the error, if any. Every event published on the
 * task's bus while the agent runs is reported to `onExecutionEvent`.
 * `cancelTask` runs without hooks.
 *
 * Returns `executor` unchanged when no plugin has execution hooks.
 */
export function withExecutionPlugins(
  executor: AgentExecutor,
  plugins: PluginManager
): AgentExecutor {
  if (!plugins.hasExecutionHooks) {
    return executor;
  }
  return {
    async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
      // If a before hook throws, the manager unwinds the plugins that ran and
      // the error fails the execution.
      await plugins.beforeExecution(requestContext);
      const report = (event: AgentExecutionEvent) =>
        plugins.onExecutionEvent(requestContext, event);
      eventBus.on('event', report);
      let error: unknown;
      try {
        await plugins.aroundExecution(requestContext, () =>
          executor.execute(requestContext, eventBus)
        );
      } catch (e) {
        error = e;
        throw e;
      } finally {
        eventBus.off('event', report);
        await plugins.afterExecution(requestContext, error);
      }
    },
    cancelTask: (taskId, eventBus) => executor.cancelTask(taskId, eventBus),
  };
}

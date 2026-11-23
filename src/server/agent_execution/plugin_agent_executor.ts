import type { PluginManager } from '../../plugins/types.js';
import type {
  AgentExecutionEvent,
  EventListener,
  ExecutionEventBus,
  ExecutionEventName,
  FinishedListener,
} from '../events/execution_event_bus.js';
import type { AgentExecutor } from './agent_executor.js';
import type { RequestContext } from './request_context.js';

type AnyListener = EventListener | FinishedListener;
// The interface overloads only pair each event name with its listener type.
// Forwarding passes the caller's pair through unchanged, so accept any pair.
type Forward = (eventName: ExecutionEventName, listener: AnyListener) => unknown;

/**
 * The bus handed to the agent: reports each event the agent publishes to
 * `onExecutionEvent`, then forwards it. Events published on the inner bus by
 * anyone else (another execution, the SDK) are not reported.
 */
class PluginEventBus implements ExecutionEventBus {
  constructor(
    private readonly inner: ExecutionEventBus,
    private readonly plugins: PluginManager,
    private readonly requestContext: RequestContext
  ) {}

  publish(event: AgentExecutionEvent): void {
    this.plugins.onExecutionEvent(this.requestContext, event);
    this.inner.publish(event);
  }

  on(eventName: ExecutionEventName, listener: AnyListener): this {
    (this.inner.on as Forward).call(this.inner, eventName, listener);
    return this;
  }

  off(eventName: ExecutionEventName, listener: AnyListener): this {
    (this.inner.off as Forward).call(this.inner, eventName, listener);
    return this;
  }

  once(eventName: ExecutionEventName, listener: AnyListener): this {
    (this.inner.once as Forward).call(this.inner, eventName, listener);
    return this;
  }

  removeAllListeners(eventName?: ExecutionEventName): this {
    this.inner.removeAllListeners(eventName);
    return this;
  }

  finished(): void {
    this.inner.finished();
  }
}

/**
 * Wraps `executor` so `execute` runs the plugin execution hooks:
 * `beforeExecution`, then `execute` inside `aroundExecution`, then
 * `afterExecution` with the error, if any. Each event the agent publishes is
 * reported to `onExecutionEvent`. `cancelTask` runs without hooks.
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
      const agentBus = new PluginEventBus(eventBus, plugins, requestContext);
      let error: unknown;
      try {
        await plugins.aroundExecution(requestContext, () =>
          executor.execute(requestContext, agentBus)
        );
      } catch (e) {
        error = e;
        throw e;
      } finally {
        await plugins.afterExecution(requestContext, error);
      }
    },
    cancelTask: (taskId, eventBus) => executor.cancelTask(taskId, eventBus),
  };
}

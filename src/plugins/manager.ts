import type { RequestContext } from '../server/agent_execution/request_context.js';
import type { AgentExecutionEvent } from '../server/events/execution_event_bus.js';
import type {
  A2APlugin,
  ClientRequest,
  ClientResponse,
  PluginManager,
  PushRequest,
  PushResult,
  ServerRequest,
  ServerResponse,
  TaskEventInfo,
} from './types.js';

type Hook = keyof Omit<A2APlugin, 'name'>;
type Flag = Exclude<keyof PluginManager, keyof A2APlugin>;

const HOOKS_BY_FLAG: Record<Flag, readonly Hook[]> = {
  hasServerHooks: ['beforeHandlerRun', 'afterHandlerRun', 'aroundHandlerRun'],
  hasClientHooks: ['beforeClientRequest', 'afterClientRequest', 'aroundClientRequest'],
  hasExecutionHooks: ['beforeExecution', 'onExecutionEvent', 'afterExecution', 'aroundExecution'],
  hasTaskHooks: ['onTaskEvent'],
  hasPushHooks: ['beforePushSend', 'onPushSent'],
};

function isPluginManager(plugin: A2APlugin): plugin is PluginManager {
  return typeof (plugin as Partial<PluginManager>).hasServerHooks === 'boolean';
}

/** Returns the plugins implementing a hook of a group; nested managers only if non-empty. */
function select(plugins: readonly A2APlugin[], flag: Flag): A2APlugin[] {
  return plugins.filter((p) =>
    isPluginManager(p) ? p[flag] : HOOKS_BY_FLAG[flag].some((hook) => p[hook] !== undefined)
  );
}

function logHookError(plugin: A2APlugin, hook: Hook, error: unknown): void {
  console.error(`A2A plugin '${plugin.name}' failed in ${hook}:`, error);
}

/** Runs a hook, logging and swallowing any error. */
async function runSafely(
  plugin: A2APlugin,
  hook: Hook,
  call: () => void | Promise<void>
): Promise<void> {
  try {
    await call();
  } catch (error) {
    logHookError(plugin, hook, error);
  }
}

type AroundHook = 'aroundHandlerRun' | 'aroundClientRequest' | 'aroundExecution';

/** Composes `around` hooks so that the first plugin is the outermost wrapper. */
function wrap<T>(
  plugins: readonly A2APlugin[],
  hook: AroundHook,
  around: (plugin: A2APlugin, next: () => T) => T,
  next: () => T
): T {
  let call = next;
  for (const plugin of [...plugins].reverse()) {
    if (plugin[hook] === undefined) continue;
    const inner = call;
    call = () => around(plugin, inner);
  }
  return call();
}

/**
 * Runs plugins one after another in registration order.
 *
 * - `before*` hooks run in registration order. If one throws, the plugins
 *   that already ran get their matching `after*` hook with the error, and the
 *   error propagates. `beforePushSend` has no matching hook to unwind.
 * - `around*` hooks wrap the call; the first plugin is the outermost wrapper.
 * - `after*` hooks run in reverse order. Their errors are logged and swallowed.
 * - Observer hooks (`on*`) run in registration order. Their errors are logged
 *   and swallowed.
 */
export class SequentialPluginManager implements PluginManager {
  readonly name: string = 'sequential';

  private readonly _plugins: readonly A2APlugin[];
  private readonly server: readonly A2APlugin[];
  private readonly client: readonly A2APlugin[];
  private readonly execution: readonly A2APlugin[];
  private readonly task: readonly A2APlugin[];
  private readonly push: readonly A2APlugin[];

  constructor(...plugins: A2APlugin[]) {
    const invalid = plugins.filter((p) => typeof p !== 'object' || p === null);
    if (invalid.length > 0) {
      throw new TypeError(`Not A2A plugins: ${invalid.map(String).join(', ')}`);
    }
    this._plugins = [...plugins];
    this.server = select(plugins, 'hasServerHooks');
    this.client = select(plugins, 'hasClientHooks');
    this.execution = select(plugins, 'hasExecutionHooks');
    this.task = select(plugins, 'hasTaskHooks');
    this.push = select(plugins, 'hasPushHooks');
  }

  /** The registered plugins, in registration order. */
  get plugins(): readonly A2APlugin[] {
    return this._plugins;
  }

  get hasServerHooks(): boolean {
    return this.server.length > 0;
  }

  get hasClientHooks(): boolean {
    return this.client.length > 0;
  }

  get hasExecutionHooks(): boolean {
    return this.execution.length > 0;
  }

  get hasTaskHooks(): boolean {
    return this.task.length > 0;
  }

  get hasPushHooks(): boolean {
    return this.push.length > 0;
  }

  // Server.

  async beforeHandlerRun(request: ServerRequest): Promise<void> {
    const ran: A2APlugin[] = [];
    for (const plugin of this.server) {
      try {
        await plugin.beforeHandlerRun?.(request);
      } catch (error) {
        const response: ServerResponse = {
          method: request.method,
          context: request.context,
          error,
          isStreamEvent: false,
          isFinal: true,
        };
        for (const done of ran.reverse()) {
          await runSafely(done, 'afterHandlerRun', () => done.afterHandlerRun?.(response));
        }
        throw error;
      }
      ran.push(plugin);
    }
  }

  async afterHandlerRun(response: ServerResponse): Promise<void> {
    for (const plugin of [...this.server].reverse()) {
      await runSafely(plugin, 'afterHandlerRun', () => plugin.afterHandlerRun?.(response));
    }
  }

  aroundHandlerRun<T>(request: ServerRequest, next: () => T): T {
    return wrap(
      this.server,
      'aroundHandlerRun',
      (p, inner) => p.aroundHandlerRun!(request, inner),
      next
    );
  }

  // Client.

  async beforeClientRequest(request: ClientRequest): Promise<void> {
    const ran: A2APlugin[] = [];
    for (const plugin of this.client) {
      try {
        await plugin.beforeClientRequest?.(request);
      } catch (error) {
        const response: ClientResponse = {
          method: request.method,
          options: request.options,
          error,
          isStreamEvent: false,
          isFinal: true,
        };
        for (const done of ran.reverse()) {
          await runSafely(done, 'afterClientRequest', () => done.afterClientRequest?.(response));
        }
        throw error;
      }
      ran.push(plugin);
    }
  }

  async afterClientRequest(response: ClientResponse): Promise<void> {
    for (const plugin of [...this.client].reverse()) {
      await runSafely(plugin, 'afterClientRequest', () => plugin.afterClientRequest?.(response));
    }
  }

  aroundClientRequest<T>(request: ClientRequest, next: () => T): T {
    return wrap(
      this.client,
      'aroundClientRequest',
      (p, inner) => p.aroundClientRequest!(request, inner),
      next
    );
  }

  // Execution.

  async beforeExecution(requestContext: RequestContext): Promise<void> {
    const ran: A2APlugin[] = [];
    for (const plugin of this.execution) {
      try {
        await plugin.beforeExecution?.(requestContext);
      } catch (error) {
        for (const done of ran.reverse()) {
          await runSafely(done, 'afterExecution', () =>
            done.afterExecution?.(requestContext, error)
          );
        }
        throw error;
      }
      ran.push(plugin);
    }
  }

  onExecutionEvent(requestContext: RequestContext, event: AgentExecutionEvent): void {
    for (const plugin of this.execution) {
      try {
        plugin.onExecutionEvent?.(requestContext, event);
      } catch (error) {
        logHookError(plugin, 'onExecutionEvent', error);
      }
    }
  }

  async afterExecution(requestContext: RequestContext, error?: unknown): Promise<void> {
    for (const plugin of [...this.execution].reverse()) {
      await runSafely(plugin, 'afterExecution', () =>
        plugin.afterExecution?.(requestContext, error)
      );
    }
  }

  aroundExecution<T>(requestContext: RequestContext, next: () => T): T {
    return wrap(
      this.execution,
      'aroundExecution',
      (p, inner) => p.aroundExecution!(requestContext, inner),
      next
    );
  }

  // Task store.

  async onTaskEvent(info: TaskEventInfo): Promise<void> {
    for (const plugin of this.task) {
      await runSafely(plugin, 'onTaskEvent', () => plugin.onTaskEvent?.(info));
    }
  }

  // Push notifications.

  async beforePushSend(request: PushRequest): Promise<void> {
    for (const plugin of this.push) {
      await plugin.beforePushSend?.(request);
    }
  }

  async onPushSent(result: PushResult): Promise<void> {
    for (const plugin of this.push) {
      await runSafely(plugin, 'onPushSent', () => plugin.onPushSent?.(result));
    }
  }
}

/** Returns a manager that runs `plugins` in the given order. */
export function sequential(...plugins: A2APlugin[]): SequentialPluginManager {
  return new SequentialPluginManager(...plugins);
}

import type { AgentCard } from '../../index.js';
import type { A2AMethodName, PluginManager, ServerRequest } from '../../plugins/types.js';
import type { ServerCallContext } from '../context.js';
import type { A2ARequestHandler } from './a2a_request_handler.js';

/** Handler methods that run server plugin hooks, with their A2A method name. */
const SERVER_METHODS = {
  getAuthenticatedExtendedAgentCard: 'GetExtendedAgentCard',
  sendMessage: 'SendMessage',
  sendMessageStream: 'SendStreamingMessage',
  getTask: 'GetTask',
  listTasks: 'ListTasks',
  cancelTask: 'CancelTask',
  createTaskPushNotificationConfig: 'CreateTaskPushNotificationConfig',
  getTaskPushNotificationConfig: 'GetTaskPushNotificationConfig',
  listTaskPushNotificationConfigs: 'ListTaskPushNotificationConfigs',
  deleteTaskPushNotificationConfig: 'DeleteTaskPushNotificationConfig',
  resubscribe: 'SubscribeToTask',
} as const satisfies Record<Exclude<keyof A2ARequestHandler, 'getAgentCard'>, A2AMethodName>;

type HandlerMethod = (params: unknown, context: ServerCallContext) => unknown;

/**
 * Replaces the request methods of `handler` with versions that run the
 * server plugin hooks. Does nothing when no plugin has server hooks.
 */
export function applyServerPlugins(
  handler: A2ARequestHandler,
  plugins: PluginManager,
  agentCard: AgentCard
): void {
  if (!plugins.hasServerHooks) {
    return;
  }
  const methods = handler as unknown as Record<string, HandlerMethod>;
  for (const [name, method] of Object.entries(SERVER_METHODS)) {
    const impl = methods[name].bind(handler);
    const streaming = method === 'SendStreamingMessage' || method === 'SubscribeToTask';
    methods[name] = (payload, context) => {
      const request: ServerRequest = { method, payload, context, agentCard };
      const call = () => impl(payload, context);
      return streaming
        ? runServerStream(plugins, request, call as () => AsyncGenerator<unknown, void, undefined>)
        : runServerCall(plugins, request, call as () => Promise<unknown>);
    };
  }
}

/**
 * Runs a unary handler call with the server plugin hooks:
 * `beforeHandlerRun`, then the call wrapped by `aroundHandlerRun`, then
 * `afterHandlerRun` with the result or the error.
 */
async function runServerCall<T>(
  plugins: PluginManager,
  request: ServerRequest,
  call: () => Promise<T>
): Promise<T> {
  const { method, context } = request;
  await plugins.beforeHandlerRun(request);
  let result: T;
  try {
    result = await plugins.aroundHandlerRun(request, call);
  } catch (error) {
    await plugins.afterHandlerRun({ method, context, error, isStreamEvent: false, isFinal: true });
    throw error;
  }
  await plugins.afterHandlerRun({
    method,
    payload: result,
    context,
    isStreamEvent: false,
    isFinal: true,
  });
  return result;
}

/**
 * Runs a streaming handler call with the server plugin hooks.
 *
 * `aroundHandlerRun` wraps every pull of the inner stream, so the handler
 * code that runs to produce an event (including the agent execution it
 * starts) runs inside the plugin's scope. `afterHandlerRun` runs once per
 * event and once more when the stream ends, including on error and when the
 * consumer stops early.
 */
async function* runServerStream<T>(
  plugins: PluginManager,
  request: ServerRequest,
  open: () => AsyncGenerator<T, void, undefined>
): AsyncGenerator<T, void, undefined> {
  const { method, context } = request;
  await plugins.beforeHandlerRun(request);
  let iterator: AsyncGenerator<T, void, undefined> | undefined;
  let error: unknown;
  try {
    iterator = open();
    while (true) {
      const next = await plugins.aroundHandlerRun(request, () => iterator!.next());
      if (next.done === true) {
        break;
      }
      await plugins.afterHandlerRun({
        method,
        payload: next.value,
        context,
        isStreamEvent: true,
        isFinal: false,
      });
      yield next.value;
    }
  } catch (e) {
    error = e;
    throw e;
  } finally {
    try {
      // Closes the inner stream if the consumer stopped early; a no-op on a
      // generator that already finished or threw.
      await iterator?.return(undefined);
    } finally {
      await plugins.afterHandlerRun({
        method,
        context,
        error,
        isStreamEvent: false,
        isFinal: true,
      });
    }
  }
}

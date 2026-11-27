import type { AgentCard } from '../../index.js';
import { runCall, runStream, type CallHooks } from '../../plugins/run.js';
import type {
  A2AMethodName,
  PluginManager,
  ServerRequest,
  ServerResponse,
} from '../../plugins/types.js';
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
  const hooks: CallHooks<ServerRequest, ServerResponse> = {
    before: (req) => plugins.beforeHandlerRun(req),
    around: (req, next) => plugins.aroundHandlerRun(req, next),
    after: (res) => plugins.afterHandlerRun(res),
    response: ({ method, context }, outcome) => ({ method, context, ...outcome }),
  };
  const methods = handler as unknown as Record<string, HandlerMethod>;
  for (const [name, method] of Object.entries(SERVER_METHODS)) {
    const impl = methods[name].bind(handler);
    const streaming = method === 'SendStreamingMessage' || method === 'SubscribeToTask';
    methods[name] = (payload, context) => {
      const request: ServerRequest = { method, payload, context, agentCard };
      const call = () => impl(payload, context);
      return streaming
        ? runStream(hooks, request, call as () => AsyncGenerator<unknown, void, undefined>)
        : runCall(hooks, request, call as () => Promise<unknown>);
    };
  }
}

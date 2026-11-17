/**
 * Plugins entry point for the A2A SDK. A plugin is one object that hooks into
 * the A2A client and server, so cross-cutting features such as telemetry,
 * authentication or experiment propagation need a single registration.
 *
 * @example
 * ```ts
 * import { sequential, type A2APlugin } from '@a2a-js/sdk/plugins';
 *
 * const taskAudit: A2APlugin = {
 *   name: 'task-audit',
 *   onTaskEvent: (info) => console.log(info.taskId, info.fromState, '->', info.toState),
 * };
 *
 * const plugins = sequential(taskAudit);
 * ```
 */

export type {
  A2AMethodName,
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
export { SequentialPluginManager, sequential } from './manager.js';

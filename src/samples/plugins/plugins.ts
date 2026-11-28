import { AsyncLocalStorage } from 'node:async_hooks';

import { TaskState, taskStateToJSON } from '../../index.js';
import { STATE_HEADERS_KEY, ServerCallContext } from '../../server/index.js';
import type { A2APlugin } from '../../plugins/index.js';

/**
 * Plugins used by this sample. Each is a plain object implementing only the
 * hooks it needs; see `src/plugins/types.ts` for the full list.
 */

/** Service parameter carrying the experiment ID from client to server. */
export const EXPERIMENT_HEADER = 'x-experiment-id';

const stateName = (state: TaskState | undefined) =>
  state === undefined ? 'new' : taskStateToJSON(state).replace('TASK_STATE_', '');

function experimentOf(context: ServerCallContext): string {
  const headers = context.state.get(STATE_HEADERS_KEY) as Record<string, string | undefined>;
  return headers?.[EXPERIMENT_HEADER] ?? 'none';
}

// --- Client ------------------------------------------------------------------

/** Adds the experiment ID to every outgoing call. */
export function experiments(experimentId: string): A2APlugin {
  return {
    name: 'experiments',
    beforeClientRequest: (req) => {
      req.options.serviceParameters = {
        ...req.options.serviceParameters,
        [EXPERIMENT_HEADER]: experimentId,
      };
    },
  };
}

// --- Server ------------------------------------------------------------------

/** Logs every call once it finishes, and every task state change. */
export const audit: A2APlugin = {
  name: 'audit',
  afterHandlerRun: ({ method, context, error, isFinal }) => {
    if (!isFinal) return;
    const outcome = error ? `failed: ${error}` : 'ok';
    console.log(
      `[audit] ${method} over ${context.protocolBinding} experiment=${experimentOf(context)} ${outcome}`
    );
  },
  onTaskEvent: ({ taskId, fromState, toState }) => {
    console.log(
      `[audit] task ${taskId.slice(0, 8)}: ${stateName(fromState)} -> ${stateName(toState)}`
    );
  },
};

/** Logs how long each call took and how many events it streamed. */
export const timing: A2APlugin = {
  name: 'timing',
  // Per-call data goes in `context.state`, which every hook of the call sees.
  beforeHandlerRun: ({ context }) => {
    context.state.set('timing.start', performance.now());
    context.state.set('timing.events', 0);
  },
  afterHandlerRun: ({ method, context, isStreamEvent, isFinal }) => {
    const events = context.state.get('timing.events') as number;
    if (isStreamEvent) context.state.set('timing.events', events + 1);
    if (!isFinal) return;
    const elapsed = performance.now() - (context.state.get('timing.start') as number);
    console.log(`[timing] ${method} took ${elapsed.toFixed(1)}ms, ${events} streamed event(s)`);
  },
};

const currentExperiment = new AsyncLocalStorage<string>();

/**
 * Runs the agent inside a scope holding the request's experiment ID, so any
 * code the agent calls can read it with {@link logWithExperiment} without the
 * agent knowing about plugins. `around*` hooks exist for this kind of scoping,
 * for example an OpenTelemetry active span.
 */
export const experimentScope: A2APlugin = {
  name: 'experiment-scope',
  aroundExecution: (requestContext, next) =>
    currentExperiment.run(experimentOf(requestContext.context), next),
};

/** `console.log` tagged with the experiment of the execution it runs in. */
export function logWithExperiment(message: string): void {
  console.log(`[agent experiment=${currentExperiment.getStore() ?? 'none'}] ${message}`);
}

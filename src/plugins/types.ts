import type { AgentCard, StreamResponse, Task, TaskState } from '../index.js';
import type { RequestOptions } from '../client/multitransport-client.js';
import type { RequestContext } from '../server/agent_execution/request_context.js';
import type { ServerCallContext } from '../server/context.js';
import type { AgentExecutionEvent } from '../server/events/execution_event_bus.js';

/** A2A method name, as defined by the specification. Identical on the client and the server. */
export type A2AMethodName =
  | 'SendMessage'
  | 'SendStreamingMessage'
  | 'GetTask'
  | 'ListTasks'
  | 'CancelTask'
  | 'SubscribeToTask'
  | 'CreateTaskPushNotificationConfig'
  | 'GetTaskPushNotificationConfig'
  | 'ListTaskPushNotificationConfigs'
  | 'DeleteTaskPushNotificationConfig'
  | 'GetExtendedAgentCard';

/** An incoming request, passed to {@link A2APlugin.beforeHandlerRun}. */
export interface ServerRequest {
  readonly method: A2AMethodName;
  /** The request payload, e.g. `SendMessageRequest`. */
  readonly payload: unknown;
  /**
   * The call context. Use its `state` to pass per-call data from
   * `beforeHandlerRun` to `afterHandlerRun`.
   */
  readonly context: ServerCallContext;
  /** The agent card served by the handler. */
  readonly agentCard: AgentCard;
}

/**
 * A handler result, passed to {@link A2APlugin.afterHandlerRun}.
 *
 * For a unary call the hook runs once with `isFinal: true`. For a stream it
 * runs once per event with `isStreamEvent: true, isFinal: false`, and once
 * more with `isFinal: true` and no payload when the stream ends, including
 * on error or when the consumer stops early.
 */
export interface ServerResponse {
  readonly method: A2AMethodName;
  /** The handler result or stream event. Undefined on error or stream end. */
  readonly payload?: unknown;
  /** The same call context passed to `beforeHandlerRun`. */
  readonly context: ServerCallContext;
  /** The error thrown by the handler, if any. */
  readonly error?: unknown;
  readonly isStreamEvent: boolean;
  readonly isFinal: boolean;
}

/** An outgoing call, passed to {@link A2APlugin.beforeClientRequest}. */
export interface ClientRequest {
  readonly method: A2AMethodName;
  /** The request payload. Plugins may replace it. */
  payload: unknown;
  /** The card of the remote agent. */
  readonly agentCard: AgentCard;
  /**
   * The request options. Plugins may modify `serviceParameters` to add
   * outgoing headers and use `context` to pass per-call data to
   * `afterClientRequest`.
   */
  options: RequestOptions;
}

/**
 * A call result, passed to {@link A2APlugin.afterClientRequest}. Follows the
 * same `isStreamEvent` / `isFinal` rules as {@link ServerResponse}.
 */
export interface ClientResponse {
  readonly method: A2AMethodName;
  /** The result or stream event. Undefined on error or stream end. */
  readonly payload?: unknown;
  /** The same options passed to `beforeClientRequest`. */
  readonly options: RequestOptions;
  /** The error thrown by the call, if any. */
  readonly error?: unknown;
  readonly isStreamEvent: boolean;
  readonly isFinal: boolean;
}

/** A successful task write, passed to {@link A2APlugin.onTaskEvent}. */
export interface TaskEventInfo {
  readonly taskId: string;
  /** Persisted state before the write. Undefined when the write created the task. */
  readonly fromState?: TaskState;
  /**
   * State after the write. Equal to `fromState` for writes that don't change
   * the state, such as artifact updates.
   */
  readonly toState: TaskState;
  /** The event that caused the write. Undefined when the SDK wrote the task without one. */
  readonly event?: AgentExecutionEvent;
  /** The task after the write. Copy it if you keep it beyond the hook call. */
  readonly task: Task;
  /** Call context of the request that produced the write. */
  readonly context: ServerCallContext;
}

/** One push notification delivery, passed to {@link A2APlugin.beforePushSend}. */
export interface PushRequest {
  readonly taskId: string;
  /** Webhook URL. */
  readonly url: string;
  /** Outgoing HTTP headers. Plugins may add or change entries. */
  readonly headers: Record<string, string>;
  /** The event being pushed. */
  readonly event: StreamResponse;
  /** Set to `true` to drop this delivery. */
  skip: boolean;
  /** Per-delivery plugin state, available again in {@link PushResult.request}. */
  readonly state: Map<string, unknown>;
}

/** The outcome of one push notification delivery, passed to {@link A2APlugin.onPushSent}. */
export interface PushResult {
  readonly request: PushRequest;
  /** Duration of the HTTP request in milliseconds. */
  readonly durationMs: number;
  /** HTTP status code. Undefined if no response was received. */
  readonly statusCode?: number;
  /** The error if the delivery failed. */
  readonly error?: unknown;
  /** Whether a plugin dropped the delivery. */
  readonly skipped: boolean;
}

/**
 * A plugin hooks into the A2A client and server through one object. Implement
 * only the hooks you need; every hook is optional.
 *
 * - `before*` hooks may modify their argument or reject the call by throwing.
 * - `after*` and observer (`on*`) hooks run for their side effects. Their
 *   errors are logged and swallowed.
 * - `around*` hooks wrap the call and must return `next()`'s result. Use them
 *   to run the call inside a scope, e.g. an OpenTelemetry active context.
 *
 * See {@link SequentialPluginManager} for the order in which hooks of several
 * plugins run.
 */
export interface A2APlugin {
  /** Name used in logs. */
  readonly name: string;

  // Server: around each request handled by `DefaultRequestHandler`.

  /** Called before the handler processes a request. Throw to reject the request. */
  beforeHandlerRun?(request: ServerRequest): void | Promise<void>;
  /** Called with the handler result, per stream event, and at the end. */
  afterHandlerRun?(response: ServerResponse): void | Promise<void>;
  /** Wraps the handler call, after `beforeHandlerRun`. Must return `next()`. */
  aroundHandlerRun?<T>(request: ServerRequest, next: () => T): T;

  // Client: around each call made by `Client`, outside its interceptors.

  /** Called before the request is sent. Throw to cancel it. */
  beforeClientRequest?(request: ClientRequest): void | Promise<void>;
  /** Called with the result, per stream event, and at the end. */
  afterClientRequest?(response: ClientResponse): void | Promise<void>;
  /** Wraps the call, after `beforeClientRequest`. Must return `next()`. */
  aroundClientRequest?<T>(request: ClientRequest, next: () => T): T;

  // Execution: around `AgentExecutor.execute`, which runs outside the request.

  /** Called before the agent runs. Throw to fail the execution without running the agent. */
  beforeExecution?(requestContext: RequestContext): void | Promise<void>;
  /** Called synchronously when the agent publishes an event. Keep it cheap. */
  onExecutionEvent?(requestContext: RequestContext, event: AgentExecutionEvent): void;
  /** Called after the agent returns or throws. */
  afterExecution?(requestContext: RequestContext, error?: unknown): void | Promise<void>;
  /** Wraps `execute`, after `beforeExecution`. Must return `next()`. */
  aroundExecution?<T>(requestContext: RequestContext, next: () => T): T;

  // Task store.

  /** Called after every successful task write. */
  onTaskEvent?(info: TaskEventInfo): void | Promise<void>;

  // Push notifications.

  /** Called before the webhook request. May add headers or set `skip`. Throw to fail the delivery. */
  beforePushSend?(request: PushRequest): void | Promise<void>;
  /** Called after the delivery attempt, or when it was skipped. */
  onPushSent?(result: PushResult): void | Promise<void>;
}

/**
 * Runs registered plugins. SDK call sites depend on this type. A manager is a
 * plugin itself, so managers can be nested.
 *
 * The `has*Hooks` flags let call sites skip all plugin work when no plugin
 * implements the hooks they would call.
 */
export interface PluginManager extends Required<A2APlugin> {
  readonly hasServerHooks: boolean;
  readonly hasClientHooks: boolean;
  readonly hasExecutionHooks: boolean;
  readonly hasTaskHooks: boolean;
  readonly hasPushHooks: boolean;
}

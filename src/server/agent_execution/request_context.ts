import { Message, SendMessageRequest, Task } from '../../index.js';
import { ServerCallContext } from '../context.js';

export interface RequestContextParams {
  /** The incoming `SendMessageRequest` payload. Its `message` field MUST be set. */
  request: SendMessageRequest;
  /** The server call context associated with this request. */
  context: ServerCallContext;
  /** The resolved task ID (either from the request or server-generated). */
  taskId: string;
  /** The resolved context ID (either from the request or server-generated). */
  contextId: string;
  /** The existing `Task` object retrieved from the store, if any. */
  task?: Task;
  /** A list of other tasks related to the current request (e.g., for tool use). */
  referenceTasks?: Task[];
}

/**
 * Holds information about the current request being processed by the server.
 *
 * Wraps the incoming {@link SendMessageRequest} so agent executors can reach
 * the full payload (message, configuration, metadata, tenant) via `request`.
 */
export class RequestContext {
  /** The incoming request payload, including `message`, `configuration`, `metadata`, and `tenant`. */
  public readonly request: SendMessageRequest;
  /** The server call context associated with this request. */
  public readonly context: ServerCallContext;
  /** The resolved task ID for this request. */
  public readonly taskId: string;
  /** The resolved context ID for this request. */
  public readonly contextId: string;
  /** The existing `Task` object retrieved from the store, if any. */
  public readonly task?: Task;
  /** A list of other tasks related to the current request (e.g., for tool use). */
  public readonly referenceTasks?: Task[];

  constructor(params: RequestContextParams) {
    if (!params.request.message) {
      throw new Error('RequestContext requires request.message to be set.');
    }
    this.request = structuredClone(params.request);
    this.context = params.context;
    this.taskId = params.taskId;
    this.contextId = params.contextId;
    this.task = params.task;
    this.referenceTasks = params.referenceTasks;
  }

  get userMessage(): Message {
    return this.request.message!;
  }
}

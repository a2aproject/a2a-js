import { Message, SendMessageRequest, Task } from '../../index.js';
import { ServerCallContext } from '../context.js';

/**
 * Holds information about the current request being processed by the server.
 *
 * Wraps the incoming {@link SendMessageRequest} so agent executors can reach
 * the full payload (message, configuration, metadata, tenant) via `request`.
 */
export class RequestContext {
  public readonly request: SendMessageRequest;
  public readonly context: ServerCallContext;
  public readonly taskId: string;
  public readonly contextId: string;
  public readonly task?: Task;
  public readonly referenceTasks?: Task[];

  constructor(params: {
    request: SendMessageRequest;
    context: ServerCallContext;
    taskId: string;
    contextId: string;
    task?: Task;
    referenceTasks?: Task[];
  }) {
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

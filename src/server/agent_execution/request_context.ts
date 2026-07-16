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
  public readonly taskId: string;
  public readonly contextId: string;
  public readonly context: ServerCallContext;
  public readonly task?: Task;
  public readonly referenceTasks?: Task[];

  constructor(
    request: SendMessageRequest,
    taskId: string,
    contextId: string,
    context: ServerCallContext,
    task?: Task,
    referenceTasks?: Task[]
  ) {
    if (!request.message) {
      throw new Error('RequestContext requires request.message to be set.');
    }
    this.request = structuredClone(request);
    this.taskId = taskId;
    this.contextId = contextId;
    this.context = context;
    this.task = task;
    this.referenceTasks = referenceTasks;
  }

  get userMessage(): Message {
    return this.request.message!;
  }
}

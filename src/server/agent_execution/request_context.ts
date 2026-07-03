import { Message, Task } from '../../index.js';
import { ServerCallContext } from '../context.js';

export class RequestContext {
  public readonly userMessage: Message;
  public readonly taskId: string;
  public readonly contextId: string;
  public readonly task?: Task;
  public readonly referenceTasks?: Task[];
  public readonly context: ServerCallContext;
  /**
   * The request-level metadata from the originating `SendMessageRequest`,
   * when provided. This is the spec's "flexible key-value map for passing
   * additional context or parameters" and is distinct from
   * `userMessage.metadata`.
   */
  public readonly metadata?: Record<string, unknown>;

  constructor(
    userMessage: Message,
    taskId: string,
    contextId: string,
    context: ServerCallContext,
    task?: Task,
    referenceTasks?: Task[],
    metadata?: Record<string, unknown>
  ) {
    this.userMessage = userMessage;
    this.taskId = taskId;
    this.contextId = contextId;
    this.context = context;
    this.task = task;
    this.referenceTasks = referenceTasks;
    this.metadata = metadata ? structuredClone(metadata) : undefined;
  }
}

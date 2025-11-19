import { Message, Task } from '../../types.js';
import { ServerCallContext } from '../context.js';

export class RequestContext {
  public readonly userMessage: Message;
  public readonly taskId: string;
  public readonly contextId: string;
  public readonly task?: Task;
  public readonly referenceTasks?: Task[];
  public readonly context?: ServerCallContext;

  constructor(
    userMessage: Message,
    taskId: string,
    contextId: string,
    task?: Task,
    referenceTasks?: Task[],
    context?: ServerCallContext
  ) {
    this.userMessage = userMessage;
    this.taskId = taskId;
    this.contextId = contextId;
    this.task = task;
    this.referenceTasks = referenceTasks;
    this.context = context;
  }
}

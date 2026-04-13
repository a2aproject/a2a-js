import { Message, Task } from '../../index.js';
import { ServerCallContext } from '../context.js';

export class RequestContext {
  public readonly userMessage: Message;
  public readonly taskId: string;
  public readonly contextId: string;
  public readonly task?: Task;
  public readonly referenceTasks?: Task[];
  public readonly context: ServerCallContext;

  constructor(
    userMessage: Message,
    taskId: string,
    contextId: string,
    context: ServerCallContext,
    task?: Task,
    referenceTasks?: Task[]
  ) {
    this.userMessage = userMessage;
    this.taskId = taskId;
    this.contextId = contextId;
    this.context = context;
    this.task = task;
    this.referenceTasks = referenceTasks;
  }
}

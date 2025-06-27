import { Message, Task } from "../../types.js";
export declare class RequestContext {
    readonly userMessage: Message;
    readonly task?: Task;
    readonly referenceTasks?: Task[];
    readonly taskId: string;
    readonly contextId: string;
    constructor(userMessage: Message, taskId: string, contextId: string, task?: Task, referenceTasks?: Task[]);
}

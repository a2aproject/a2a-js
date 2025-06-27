export class RequestContext {
    userMessage;
    task;
    referenceTasks;
    taskId;
    contextId;
    constructor(userMessage, taskId, contextId, task, referenceTasks) {
        this.userMessage = userMessage;
        this.taskId = taskId;
        this.contextId = contextId;
        this.task = task;
        this.referenceTasks = referenceTasks;
    }
}
//# sourceMappingURL=request_context.js.map
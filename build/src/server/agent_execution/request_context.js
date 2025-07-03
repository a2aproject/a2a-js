"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestContext = void 0;
class RequestContext {
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
exports.RequestContext = RequestContext;
//# sourceMappingURL=request_context.js.map
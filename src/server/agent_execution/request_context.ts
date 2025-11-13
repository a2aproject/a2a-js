import {
    Message,
    Task,
} from "../../types.js";
import { ServerCallContext } from '../context.js';

export class RequestContext {
    public readonly _userMessage: Message;
    public readonly _taskId: string;
    public readonly _contextId: string;
    public readonly _task?: Task;
    public readonly _referenceTasks?: Task[]; 
    public readonly context?: ServerCallContext;

    constructor(
        userMessage: Message,
        taskId: string,
        contextId: string,
        task?: Task,
        referenceTasks?: Task[],
        context?: ServerCallContext
    ) {
        this._userMessage = userMessage;
        this._taskId = taskId;
        this._contextId = contextId,
        this._task = task;
        this._referenceTasks = referenceTasks;
        this.context = context;
    }

    public addActivatedExtension(uri: string) {
        if (this.context?.requestedExtensions.has(uri)) {
            this.context.activatedExtensions.add(uri);
        }
    }

    get requestedExtensions(): ReadonlySet<string> {
        return this.context?.requestedExtensions ?? new Set();
    }

    get activatedExtensions(): ReadonlySet<string> {
        return this.context?.activatedExtensions ?? new Set();
    }
}
import {
    Message,
    MessageSendParams,
    Task,
} from "../../types.js";
import { ServerCallContext } from '../context.js';

export class RequestContext {
    private readonly _userMessage: Message;
    private readonly _taskId: string;
    private readonly _contextId: string;
    private readonly context?: ServerCallContext;
    private readonly _task?: Task;
    private readonly _referenceTasks?: Task[]; 

    constructor(
        userMessage: Message,
        taskId: string,
        contextId: string,
        context?: ServerCallContext,
        task?: Task,
        referenceTasks?: Task[],
    ) {
        this._userMessage = userMessage;
        this._taskId = taskId;
        this._contextId = contextId;
        this.context = context;
        this._task = task;
        this._referenceTasks = referenceTasks;
    }

    get userMessage(): Message {
        return this._userMessage;
    }

    get taskId(): string {
        return this._taskId;
    }

    get contextId(): string {
        return this._contextId;
    }

    get task(): Task | undefined {
        return this._task;
    }

    get referenceTasks(): Task[] | undefined {
        return this._referenceTasks;
    }

    public addActivatedExtension(uri: string) {
        if (this.context?.requestedExtensions.has(uri)) {
            this.context.activatedExtensions.add(uri);
        }
    }

    get requestedExtensions(): ReadonlySet<string> {
        return this.context?.requestedExtensions;
    }

    get activatedExtensions(): ReadonlySet<string> {
        return this.context?.activatedExtensions;
    }
}
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import {
    Message,
    MessageSendParams,
    Task,
} from "../../types.js";
import { TaskStore } from "../store.js";
import { ServerCallContext } from '../context.js';

export class RequestContext {
    private readonly _params: MessageSendParams;
    private readonly _taskId: string;
    private readonly _contextId: string;
    private readonly context: ServerCallContext;
    private readonly _task?: Task;
    private readonly _relatedTasks?: Task[]; 
   
    constructor(
        request: MessageSendParams,
        taskId: string,
        contextId: string,
        context: ServerCallContext,
        task?: Task,
        relatedTasks?: Task[],
        ){
        this._params = request;
        this._taskId = taskId;
        this._contextId = contextId;
        this._task = task;
        this._relatedTasks = relatedTasks;
        this.context = context;
    }

    get userMessage(): Message {
        return this._params.message;
    }

    get params(): MessageSendParams | undefined {
        return this._params;
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

    get relatedTasks(): Task[] | undefined {
        return this._relatedTasks;
    }

    public addActivatedExtension(uri: string) {
        if (!this.context.activatedExtensions) {
            this.context.activatedExtensions = new Set<string>();
        }
        this.context.activatedExtensions.add(uri);
    }

    get requestedExtensions(): Set<string> {
        return this.context.requestedExtensions || new Set<string>();
    }

    get activatedExtensions(): Set<string> {
        return this.context.activatedExtensions || new Set<string>();
    }
}
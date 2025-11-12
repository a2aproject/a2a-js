import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import {
    Message,
    MessageSendParams,
    Task,
    TaskState,
} from "../../types.js";
import { TaskStore } from "../store.js";
import { RequestContext } from "./request_context.js";
import { A2AError } from "../error.js";
import { ServerCallContext } from '../context.js';

const terminalStates: TaskState[] = ["completed", "failed", "canceled", "rejected"];

export class RequestContextBuilder {
    private readonly shouldPopulateReferredTasks: boolean = false;
    private readonly taskStore: TaskStore;

    constructor(shouldPopulateReferredTasks: boolean = false, taskStore: TaskStore) {
        this.shouldPopulateReferredTasks = shouldPopulateReferredTasks;
        this.taskStore = taskStore;
    }

    public async build(
        params: MessageSendParams,
        context?: ServerCallContext
    ): Promise<RequestContext> {
        let task: Task | undefined;
        let referenceTasks: Task[] | undefined;
        const incomingMessage: Message = {...params.message};

        // incomingMessage would contain taskId, if a task already exists.
        if (incomingMessage.taskId) {
            task = await this.taskStore.load(incomingMessage.taskId);
            if (!task) {
                throw A2AError.taskNotFound(incomingMessage.taskId);
            }

            if (terminalStates.includes(task.status.state)) {
                // Throw an error that conforms to the JSON-RPC Invalid Request error specification.
                throw A2AError.invalidRequest(`Task ${task.id} is in a terminal state (${task.status.state}) and cannot be modified.`)
            }

            // Add incomingMessage to history and save the task.
            task.history = [...(task.history || []), incomingMessage];
            await this.taskStore.save(task);
        }
        // Ensure taskId is present
        const taskId = incomingMessage.taskId || uuidv4();
        incomingMessage.taskId = taskId;

        if (this.shouldPopulateReferredTasks && incomingMessage.referenceTaskIds?.length) {
            const refTaskPromises = incomingMessage.referenceTaskIds.map(async (refId) => {
                const refTask = await this.taskStore.load(refId);
                if (!refTask) {
                    console.warn(`Reference task ${refId} not found.`);
                }
                return refTask;
            });
            const loadedTasks = await Promise.all(refTaskPromises);
            referenceTasks = loadedTasks.filter((task): task is Task => !!task);
        }
        // Ensure contextId is present
        const contextId = incomingMessage.contextId || task?.contextId || uuidv4();
        incomingMessage.contextId = contextId;

        return new RequestContext({...params, message: incomingMessage}, context, task, referenceTasks);
    }
}
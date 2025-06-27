import { Message, Task } from "../types.js";
import { AgentExecutionEvent } from "./events/execution_event_bus.js";
import { TaskStore } from "./store.js";
export declare class ResultManager {
    private taskStore;
    private currentTask?;
    private latestUserMessage?;
    private finalMessageResult?;
    constructor(taskStore: TaskStore);
    setContext(latestUserMessage: Message): void;
    /**
     * Processes an agent execution event and updates the task store.
     * @param event The agent execution event.
     */
    processEvent(event: AgentExecutionEvent): Promise<void>;
    private saveCurrentTask;
    /**
     * Gets the final result, which could be a Message or a Task.
     * This should be called after the event stream has been fully processed.
     * @returns The final Message or the current Task.
     */
    getFinalResult(): Message | Task | undefined;
    /**
     * Gets the task currently being managed by this ResultManager instance.
     * This task could be one that was started with or one created during agent execution.
     * @returns The current Task or undefined if no task is active.
     */
    getCurrentTask(): Task | undefined;
}

import { Task } from "../types.js";
/**
 * Simplified interface for task storage providers.
 * Stores and retrieves the task.
 */
export interface TaskStore {
    /**
     * Saves a task.
     * Overwrites existing data if the task ID exists.
     * @param data An object containing the task.
     * @returns A promise resolving when the save operation is complete.
     */
    save(task: Task): Promise<void>;
    /**
     * Loads a task by task ID.
     * @param taskId The ID of the task to load.
     * @returns A promise resolving to an object containing the Task, or undefined if not found.
     */
    load(taskId: string): Promise<Task | undefined>;
}
export declare class InMemoryTaskStore implements TaskStore {
    private store;
    load(taskId: string): Promise<Task | undefined>;
    save(task: Task): Promise<void>;
}

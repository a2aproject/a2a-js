import { TaskStatus, Artifact } from "../types.js";
/**
 * Generates a timestamp in ISO 8601 format.
 * @returns The current timestamp as a string.
 */
export declare function getCurrentTimestamp(): string;
/**
 * Checks if a value is a plain object (excluding arrays and null).
 * @param value The value to check.
 * @returns True if the value is a plain object, false otherwise.
 */
export declare function isObject(value: unknown): value is Record<string, any>;
/**
 * Type guard to check if an object is a TaskStatus update (lacks 'parts').
 * Used to differentiate yielded updates from the handler.
 */
export declare function isTaskStatusUpdate(update: any): update is Omit<TaskStatus, "timestamp">;
/**
 * Type guard to check if an object is an Artifact update (has 'parts').
 * Used to differentiate yielded updates from the handler.
 */
export declare function isArtifactUpdate(update: any): update is Artifact;

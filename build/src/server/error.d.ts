import * as schema from "../types.js";
/**
 * Custom error class for A2A server operations, incorporating JSON-RPC error codes.
 */
export declare class A2AError extends Error {
    code: number;
    data?: Record<string, unknown>;
    taskId?: string;
    constructor(code: number, message: string, data?: Record<string, unknown>, taskId?: string);
    /**
     * Formats the error into a standard JSON-RPC error object structure.
     */
    toJSONRPCError(): schema.JSONRPCError;
    static parseError(message: string, data?: Record<string, unknown>): A2AError;
    static invalidRequest(message: string, data?: Record<string, unknown>): A2AError;
    static methodNotFound(method: string): A2AError;
    static invalidParams(message: string, data?: Record<string, unknown>): A2AError;
    static internalError(message: string, data?: Record<string, unknown>): A2AError;
    static taskNotFound(taskId: string): A2AError;
    static taskNotCancelable(taskId: string): A2AError;
    static pushNotificationNotSupported(): A2AError;
    static unsupportedOperation(operation: string): A2AError;
}

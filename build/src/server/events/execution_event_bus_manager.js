"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultExecutionEventBusManager = void 0;
const execution_event_bus_js_1 = require("./execution_event_bus.js");
class DefaultExecutionEventBusManager {
    taskIdToBus = new Map();
    /**
     * Creates or retrieves an existing ExecutionEventBus based on the taskId.
     * @param taskId The ID of the task.
     * @returns An instance of IExecutionEventBus.
     */
    createOrGetByTaskId(taskId) {
        if (!this.taskIdToBus.has(taskId)) {
            this.taskIdToBus.set(taskId, new execution_event_bus_js_1.DefaultExecutionEventBus());
        }
        return this.taskIdToBus.get(taskId);
    }
    /**
     * Retrieves an existing ExecutionEventBus based on the taskId.
     * @param taskId The ID of the task.
     * @returns An instance of IExecutionEventBus or undefined if not found.
     */
    getByTaskId(taskId) {
        return this.taskIdToBus.get(taskId);
    }
    /**
     * Removes the event bus for a given taskId.
     * This should be called when an execution flow is complete to free resources.
     * @param taskId The ID of the task.
     */
    cleanupByTaskId(taskId) {
        const bus = this.taskIdToBus.get(taskId);
        if (bus) {
            bus.removeAllListeners();
        }
        this.taskIdToBus.delete(taskId);
    }
}
exports.DefaultExecutionEventBusManager = DefaultExecutionEventBusManager;
//# sourceMappingURL=execution_event_bus_manager.js.map
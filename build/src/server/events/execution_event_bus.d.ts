import { EventEmitter } from 'events';
import { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from "../../types.js";
export type AgentExecutionEvent = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;
export interface ExecutionEventBus {
    publish(event: AgentExecutionEvent): void;
    on(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this;
    off(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this;
    once(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this;
    removeAllListeners(eventName?: 'event' | 'finished'): this;
    finished(): void;
}
export declare class DefaultExecutionEventBus extends EventEmitter implements ExecutionEventBus {
    constructor();
    publish(event: AgentExecutionEvent): void;
    finished(): void;
}

import { ExecutionEventBus, AgentExecutionEvent } from "./execution_event_bus.js";
/**
 * An async queue that subscribes to an ExecutionEventBus for events
 * and provides an async generator to consume them.
 */
export declare class ExecutionEventQueue {
    private eventBus;
    private eventQueue;
    private resolvePromise?;
    private stopped;
    private boundHandleEvent;
    constructor(eventBus: ExecutionEventBus);
    private handleEvent;
    private handleFinished;
    /**
     * Provides an async generator that yields events from the event bus.
     * Stops when a Message event is received or a TaskStatusUpdateEvent with final=true is received.
     */
    events(): AsyncGenerator<AgentExecutionEvent, void, undefined>;
    /**
     * Stops the event queue from processing further events.
     */
    stop(): void;
}

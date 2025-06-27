/**
 * An async queue that subscribes to an ExecutionEventBus for events
 * and provides an async generator to consume them.
 */
export class ExecutionEventQueue {
    eventBus;
    eventQueue = [];
    resolvePromise;
    stopped = false;
    boundHandleEvent;
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.eventBus.on('event', this.handleEvent);
        this.eventBus.on('finished', this.handleFinished);
    }
    handleEvent = (event) => {
        if (this.stopped)
            return;
        this.eventQueue.push(event);
        if (this.resolvePromise) {
            this.resolvePromise();
            this.resolvePromise = undefined;
        }
    };
    handleFinished = () => {
        this.stop();
    };
    /**
     * Provides an async generator that yields events from the event bus.
     * Stops when a Message event is received or a TaskStatusUpdateEvent with final=true is received.
     */
    async *events() {
        while (!this.stopped || this.eventQueue.length > 0) {
            if (this.eventQueue.length > 0) {
                const event = this.eventQueue.shift();
                yield event;
                if (event.kind === 'message' || (event.kind === 'status-update' &&
                    event.final)) {
                    this.handleFinished();
                    break;
                }
            }
            else if (!this.stopped) {
                await new Promise((resolve) => {
                    this.resolvePromise = resolve;
                });
            }
        }
    }
    /**
     * Stops the event queue from processing further events.
     */
    stop() {
        this.stopped = true;
        if (this.resolvePromise) {
            this.resolvePromise(); // Unblock any pending await
            this.resolvePromise = undefined;
        }
        this.eventBus.off('event', this.handleEvent);
        this.eventBus.off('finished', this.handleFinished);
    }
}
//# sourceMappingURL=execution_event_queue.js.map
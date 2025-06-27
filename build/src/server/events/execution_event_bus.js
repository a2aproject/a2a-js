import { EventEmitter } from 'events';
export class DefaultExecutionEventBus extends EventEmitter {
    constructor() {
        super();
    }
    publish(event) {
        this.emit('event', event);
    }
    finished() {
        this.emit('finished');
    }
}
//# sourceMappingURL=execution_event_bus.js.map
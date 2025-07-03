"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultExecutionEventBus = void 0;
const events_1 = require("events");
class DefaultExecutionEventBus extends events_1.EventEmitter {
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
exports.DefaultExecutionEventBus = DefaultExecutionEventBus;
//# sourceMappingURL=execution_event_bus.js.map
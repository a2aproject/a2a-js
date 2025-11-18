import { EventEmitter } from 'events';

import { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '../../types.js';

export type AgentExecutionEvent = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

export interface ExecutionEventBus {
  publish(event: AgentExecutionEvent): void;
  on(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this;
  off(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this;
  once(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this;
  removeAllListeners(eventName?: 'event' | 'finished'): this;
  finished(): void;
}

export class DefaultExecutionEventBus extends EventEmitter implements ExecutionEventBus {
  constructor() {
    super();
  }

  publish(event: AgentExecutionEvent): void {
    this.emit('event', event);
  }

  finished(): void {
    this.emit('finished');
  }
}

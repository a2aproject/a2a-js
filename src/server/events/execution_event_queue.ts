import { TaskStatusUpdateEvent } from '../../types.js';
import { ExecutionEventBus, AgentExecutionEvent } from './execution_event_bus.js';

/**
 * An async queue that subscribes to an ExecutionEventBus for events
 * and provides an async generator to consume them.
 */
export class ExecutionEventQueue {
  private eventBus: ExecutionEventBus;
  private eventQueue: AgentExecutionEvent[] = [];
  private resolvePromise?: (value: void | PromiseLike<void>) => void;
  private stopped: boolean = false;
  private boundHandleEvent: (event: AgentExecutionEvent) => void;

  constructor(eventBus: ExecutionEventBus) {
    this.eventBus = eventBus;
    this.eventBus.on('event', this.handleEvent);
    this.eventBus.on('finished', this.handleFinished);
  }

  private handleEvent = (event: AgentExecutionEvent) => {
    if (this.stopped) return;
    this.eventQueue.push(event);
    if (this.resolvePromise) {
      this.resolvePromise();
      this.resolvePromise = undefined;
    }
  };

  private handleFinished = () => {
    this.stop();
  };

  /**
   * Provides an async generator that yields events from the event bus.
   * Stops when a Message event is received or a TaskStatusUpdateEvent with final=true is received.
   */
  public async *events(): AsyncGenerator<AgentExecutionEvent, void, undefined> {
    while (!this.stopped || this.eventQueue.length > 0) {
      if (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift()!;
        yield event;
        if (
          event.kind === 'message' ||
          (event.kind === 'status-update' && (event as TaskStatusUpdateEvent).final)
        ) {
          this.handleFinished();
          break;
        }
      } else if (!this.stopped) {
        await new Promise<void>((resolve) => {
          this.resolvePromise = resolve;
        });
      }
    }
  }

  /**
   * Stops the event queue from processing further events.
   */
  public stop(): void {
    this.stopped = true;
    if (this.resolvePromise) {
      this.resolvePromise(); // Unblock any pending await
      this.resolvePromise = undefined;
    }

    this.eventBus.off('event', this.handleEvent);
    this.eventBus.off('finished', this.handleFinished);
  }
}

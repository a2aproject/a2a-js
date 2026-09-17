import { ExecutionEventBus, AgentExecutionEvent } from './execution_event_bus.js';
import { INPUT_REQUIRED_STATE_LIST, TERMINAL_STATE_LIST } from '../utils.js';

/**
 * An async queue that subscribes to an ExecutionEventBus for events
 * and provides an async generator to consume them.
 */
export class ExecutionEventQueue {
  private eventBus: ExecutionEventBus;
  private eventQueue: AgentExecutionEvent[] = [];
  private resolvePromise?: (value: void | PromiseLike<void>) => void;
  private stopped: boolean = false;

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
   * Async generator yielding events from the bus. Terminates on Message,
   * terminal Task status, or INPUT_REQUIRED. AUTH_REQUIRED is deliberately
   * NOT in the stop set: the executor resumes publishing on the same bus
   * after the out-of-band credential injection, so the queue must stay
   * drainable. Blocking callers return a snapshot at AUTH_REQUIRED via a
   * separate code path and a background consumer keeps draining until a
   * terminal state is reached.
   */
  public async *events(): AsyncGenerator<AgentExecutionEvent, void, undefined> {
    while (!this.stopped || this.eventQueue.length > 0) {
      if (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift()!;
        yield event;
        if (
          event.kind === 'message' ||
          (event.kind === 'statusUpdate' &&
            event.data.status &&
            (TERMINAL_STATE_LIST.includes(event.data.status.state) ||
              INPUT_REQUIRED_STATE_LIST.includes(event.data.status.state)))
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

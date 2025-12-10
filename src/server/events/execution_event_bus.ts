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

/**
 * CustomEvent polyfill for Node.js 15-18 (CustomEvent was added globally in Node.js 19).
 * In browsers and modern edge runtimes, CustomEvent is already available globally.
 * Per the spec, detail defaults to null when not provided.
 */
const CustomEventImpl: typeof CustomEvent =
  typeof CustomEvent !== 'undefined'
    ? CustomEvent
    : (class CustomEventPolyfill<T> extends Event {
        readonly detail: T;
        constructor(type: string, eventInitDict?: CustomEventInit<T>) {
          super(type, eventInitDict);
          this.detail = (eventInitDict?.detail ?? null) as T;
        }
      } as typeof CustomEvent);

/**
 * Listener type matching the ExecutionEventBus interface.
 */
type Listener = (event: AgentExecutionEvent) => void;

/**
 * Type for wrapped listener functions registered with EventTarget.
 */
type WrappedListener = (e: Event) => void;

/**
 * Type guard to narrow Event to CustomEvent with AgentExecutionEvent payload.
 * This guard should always pass for 'event' type events since we control
 * the dispatch via publish(). If it fails, there's a bug in the implementation.
 */
function isAgentExecutionCustomEvent(e: Event): e is CustomEvent<AgentExecutionEvent> {
  return e instanceof CustomEventImpl;
}

/**
 * Web-compatible ExecutionEventBus using EventTarget.
 * Works across all modern runtimes: Node.js 15+, browsers, Cloudflare Workers, Deno, Bun.
 *
 * This is a drop-in replacement for Node.js EventEmitter with identical API and
 * memory semantics. Listeners are held until explicitly removed (via `off()` or
 * `removeAllListeners()`) or until the instance is garbage collected - exactly
 * like EventEmitter. No additional cleanup is required beyond standard practices.
 */
export class DefaultExecutionEventBus extends EventTarget implements ExecutionEventBus {
  // Separate storage for each event type - both use the interface's Listener type
  // but are invoked differently (with event payload vs. no arguments)
  private eventListeners: Map<Listener, WrappedListener[]> = new Map();
  private finishedListeners: Map<Listener, WrappedListener[]> = new Map();

  publish(event: AgentExecutionEvent): void {
    this.dispatchEvent(new CustomEventImpl('event', { detail: event }));
  }

  finished(): void {
    this.dispatchEvent(new Event('finished'));
  }

  /**
   * EventEmitter-compatible 'on' method.
   * Wraps the listener to extract event detail from CustomEvent.
   * Supports multiple registrations of the same listener (like EventEmitter).
   */
  on(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this {
    if (eventName === 'event') {
      this.addEventListenerInternal(listener);
    } else {
      // For 'finished' events, the listener is called with no arguments.
      // The interface types it as receiving AgentExecutionEvent for API simplicity,
      // but the actual runtime behavior (matching EventEmitter) passes no args.
      this.addFinishedListenerInternal(listener);
    }
    return this;
  }

  /**
   * EventEmitter-compatible 'off' method.
   * Uses the stored wrapped listener for proper removal.
   * Removes one instance at a time (LIFO order, like EventEmitter).
   */
  off(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this {
    if (eventName === 'event') {
      this.removeEventListenerInternal(listener);
    } else {
      this.removeFinishedListenerInternal(listener);
    }
    return this;
  }

  /**
   * EventEmitter-compatible 'once' method.
   * Listener is automatically removed after first invocation.
   * Supports multiple registrations of the same listener (like EventEmitter).
   */
  once(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this {
    if (eventName === 'event') {
      this.addEventListenerOnceInternal(listener);
    } else {
      this.addFinishedListenerOnceInternal(listener);
    }
    return this;
  }

  /**
   * EventEmitter-compatible 'removeAllListeners' method.
   * Removes all listeners for a specific event or all events.
   */
  removeAllListeners(eventName?: 'event' | 'finished'): this {
    if (eventName === undefined || eventName === 'event') {
      for (const wrappedListeners of this.eventListeners.values()) {
        for (const wrapped of wrappedListeners) {
          this.removeEventListener('event', wrapped);
        }
      }
      this.eventListeners.clear();
    }

    if (eventName === undefined || eventName === 'finished') {
      for (const wrappedListeners of this.finishedListeners.values()) {
        for (const wrapped of wrappedListeners) {
          this.removeEventListener('finished', wrapped);
        }
      }
      this.finishedListeners.clear();
    }

    return this;
  }

  // ─── Internal methods for 'event' listeners ────────────────────────────────

  private addEventListenerInternal(listener: Listener): void {
    const wrapped: WrappedListener = (e: Event) => {
      if (!isAgentExecutionCustomEvent(e)) {
        throw new Error('Internal error: expected CustomEvent for "event" type');
      }
      listener.call(this, e.detail);
    };

    const existing = this.eventListeners.get(listener);
    if (existing) {
      existing.push(wrapped);
    } else {
      this.eventListeners.set(listener, [wrapped]);
    }
    this.addEventListener('event', wrapped);
  }

  private removeEventListenerInternal(listener: Listener): void {
    const wrappedList = this.eventListeners.get(listener);
    if (wrappedList && wrappedList.length > 0) {
      const wrapped = wrappedList.pop()!;
      this.removeEventListener('event', wrapped);
      if (wrappedList.length === 0) {
        this.eventListeners.delete(listener);
      }
    }
  }

  private addEventListenerOnceInternal(listener: Listener): void {
    const wrapped: WrappedListener = (e: Event) => {
      // Validate first before any state changes
      if (!isAgentExecutionCustomEvent(e)) {
        throw new Error('Internal error: expected CustomEvent for "event" type');
      }

      // Clean up tracking
      const wrappedList = this.eventListeners.get(listener);
      if (wrappedList) {
        const index = wrappedList.indexOf(wrapped);
        if (index !== -1) {
          wrappedList.splice(index, 1);
        }
        if (wrappedList.length === 0) {
          this.eventListeners.delete(listener);
        }
      }

      listener.call(this, e.detail);
    };

    const existing = this.eventListeners.get(listener);
    if (existing) {
      existing.push(wrapped);
    } else {
      this.eventListeners.set(listener, [wrapped]);
    }
    this.addEventListener('event', wrapped, { once: true });
  }

  // ─── Internal methods for 'finished' listeners ─────────────────────────────
  // The interface declares listeners as (event: AgentExecutionEvent) => void,
  // but for 'finished' events they are invoked with no arguments (EventEmitter behavior).
  // We use Function.prototype.call to invoke with `this` as the event bus (matching
  // EventEmitter semantics) and no arguments, which is type-safe.

  private addFinishedListenerInternal(listener: Listener): void {
    const wrapped: WrappedListener = () => {
      listener.call(this);
    };

    const existing = this.finishedListeners.get(listener);
    if (existing) {
      existing.push(wrapped);
    } else {
      this.finishedListeners.set(listener, [wrapped]);
    }
    this.addEventListener('finished', wrapped);
  }

  private removeFinishedListenerInternal(listener: Listener): void {
    const wrappedList = this.finishedListeners.get(listener);
    if (wrappedList && wrappedList.length > 0) {
      const wrapped = wrappedList.pop()!;
      this.removeEventListener('finished', wrapped);
      if (wrappedList.length === 0) {
        this.finishedListeners.delete(listener);
      }
    }
  }

  private addFinishedListenerOnceInternal(listener: Listener): void {
    const wrapped: WrappedListener = () => {
      // Clean up tracking
      const wrappedList = this.finishedListeners.get(listener);
      if (wrappedList) {
        const index = wrappedList.indexOf(wrapped);
        if (index !== -1) {
          wrappedList.splice(index, 1);
        }
        if (wrappedList.length === 0) {
          this.finishedListeners.delete(listener);
        }
      }

      listener.call(this);
    };

    const existing = this.finishedListeners.get(listener);
    if (existing) {
      existing.push(wrapped);
    } else {
      this.finishedListeners.set(listener, [wrapped]);
    }
    this.addEventListener('finished', wrapped, { once: true });
  }
}

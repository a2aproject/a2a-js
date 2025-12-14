import { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '../../types.js';

export type AgentExecutionEvent = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

/**
 * Event names supported by ExecutionEventBus.
 */
export type ExecutionEventName = 'event' | 'finished';

export interface ExecutionEventBus {
  publish(event: AgentExecutionEvent): void;
  on(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this;
  off(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this;
  once(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this;
  removeAllListeners(eventName?: ExecutionEventName): this;
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
 * This implementation provides the subset of EventEmitter methods defined in the
 * ExecutionEventBus interface. Users extending DefaultExecutionEventBus should note
 * that other EventEmitter methods (e.g., listenerCount, rawListeners) are not available.
 */
export class DefaultExecutionEventBus extends EventTarget implements ExecutionEventBus {
  // Separate storage for each event type - both use the interface's Listener type
  // but are invoked differently (with event payload vs. no arguments)
  private readonly eventListeners: Map<Listener, WrappedListener[]> = new Map();
  private readonly finishedListeners: Map<Listener, WrappedListener[]> = new Map();

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
   * @param eventName The event name to listen for.
   * @param listener The callback function to invoke when the event is emitted.
   * @returns This instance for method chaining.
   */
  on(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this {
    if (eventName === 'event') {
      this.addEventListenerInternal(listener);
    } else {
      this.addFinishedListenerInternal(listener);
    }
    return this;
  }

  /**
   * EventEmitter-compatible 'off' method.
   * Uses the stored wrapped listener for proper removal.
   * Removes at most one instance of a listener per call (like EventEmitter).
   * @param eventName The event name to stop listening for.
   * @param listener The callback function to remove.
   * @returns This instance for method chaining.
   */
  off(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this {
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
   * @param eventName The event name to listen for once.
   * @param listener The callback function to invoke when the event is emitted.
   * @returns This instance for method chaining.
   */
  once(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this {
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
   * @param eventName Optional event name to remove listeners for. If omitted, removes all.
   * @returns This instance for method chaining.
   */
  removeAllListeners(eventName?: ExecutionEventName): this {
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

  // ========================
  // Helper methods for listener tracking
  // ========================

  /**
   * Adds a wrapped listener to the tracking map.
   */
  private trackListener(
    listenerMap: Map<Listener, WrappedListener[]>,
    listener: Listener,
    wrapped: WrappedListener
  ): void {
    const existing = listenerMap.get(listener);
    if (existing) {
      existing.push(wrapped);
    } else {
      listenerMap.set(listener, [wrapped]);
    }
  }

  /**
   * Removes a wrapped listener from the tracking map (for once cleanup).
   */
  private untrackWrappedListener(
    listenerMap: Map<Listener, WrappedListener[]>,
    listener: Listener,
    wrapped: WrappedListener
  ): void {
    const wrappedList = listenerMap.get(listener);
    if (wrappedList && wrappedList.length > 0) {
      const index = wrappedList.indexOf(wrapped);
      if (index !== -1) {
        wrappedList.splice(index, 1);
        if (wrappedList.length === 0) {
          listenerMap.delete(listener);
        }
      }
    }
  }

  // ========================
  // Internal methods for 'event' listeners
  // ========================

  private addEventListenerInternal(listener: Listener): void {
    const wrapped: WrappedListener = (e: Event) => {
      if (!isAgentExecutionCustomEvent(e)) {
        throw new Error('Internal error: expected CustomEvent for "event" type');
      }
      listener.call(this, e.detail);
    };

    this.trackListener(this.eventListeners, listener, wrapped);
    this.addEventListener('event', wrapped);
  }

  private removeEventListenerInternal(listener: Listener): void {
    const wrappedList = this.eventListeners.get(listener);
    if (wrappedList && wrappedList.length > 0) {
      const wrapped = wrappedList.pop()!;
      if (wrappedList.length === 0) {
        this.eventListeners.delete(listener);
      }
      this.removeEventListener('event', wrapped);
    }
  }

  private addEventListenerOnceInternal(listener: Listener): void {
    const wrapped: WrappedListener = (e: Event) => {
      // Validate first before any state changes
      if (!isAgentExecutionCustomEvent(e)) {
        throw new Error('Internal error: expected CustomEvent for "event" type');
      }

      // Clean up tracking
      this.untrackWrappedListener(this.eventListeners, listener, wrapped);

      listener.call(this, e.detail);
    };

    this.trackListener(this.eventListeners, listener, wrapped);
    this.addEventListener('event', wrapped, { once: true });
  }

  // ========================
  // Internal methods for 'finished' listeners
  // ========================
  // The interface declares listeners as (event: AgentExecutionEvent) => void,
  // but for 'finished' events they are invoked with no arguments (EventEmitter behavior).
  // We use Function.prototype.call to invoke with `this` as the event bus (matching
  // EventEmitter semantics) and no arguments, which is type-safe.

  private addFinishedListenerInternal(listener: Listener): void {
    const wrapped: WrappedListener = () => {
      listener.call(this);
    };

    this.trackListener(this.finishedListeners, listener, wrapped);
    this.addEventListener('finished', wrapped);
  }

  private removeFinishedListenerInternal(listener: Listener): void {
    const wrappedList = this.finishedListeners.get(listener);
    if (wrappedList && wrappedList.length > 0) {
      const wrapped = wrappedList.pop()!;
      if (wrappedList.length === 0) {
        this.finishedListeners.delete(listener);
      }
      this.removeEventListener('finished', wrapped);
    }
  }

  private addFinishedListenerOnceInternal(listener: Listener): void {
    const wrapped: WrappedListener = () => {
      // Clean up tracking
      this.untrackWrappedListener(this.finishedListeners, listener, wrapped);

      listener.call(this);
    };

    this.trackListener(this.finishedListeners, listener, wrapped);
    this.addEventListener('finished', wrapped, { once: true });
  }
}

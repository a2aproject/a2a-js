import { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '../../types.js';

export type AgentExecutionEvent = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

/**
 * Listener type for 'event' events that receive an AgentExecutionEvent payload.
 */
export type EventListener = (event: AgentExecutionEvent) => void;

/**
 * Listener type for 'finished' events that receive no payload.
 */
export type FinishedListener = () => void;

export interface ExecutionEventBus {
  publish(event: AgentExecutionEvent): void;
  on(eventName: 'event', listener: EventListener): this;
  on(eventName: 'finished', listener: FinishedListener): this;
  off(eventName: 'event', listener: EventListener): this;
  off(eventName: 'finished', listener: FinishedListener): this;
  once(eventName: 'event', listener: EventListener): this;
  once(eventName: 'finished', listener: FinishedListener): this;
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
 * Type for wrapped listener functions stored in the listener map.
 */
type WrappedListener = (e: Event) => void;

/**
 * Union type for all listener types
 */
type AnyListener = EventListener | FinishedListener;

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
  // Track original listeners to their wrapped versions for proper removal.
  // Structure: eventName -> listener -> array of wrapped listeners (to handle multiple registrations)
  private listenerMap: Map<'event' | 'finished', Map<AnyListener, WrappedListener[]>> = new Map();

  constructor() {
    super();
    this.listenerMap.set('event', new Map());
    this.listenerMap.set('finished', new Map());
  }

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
  on(eventName: 'event', listener: EventListener): this;
  on(eventName: 'finished', listener: FinishedListener): this;
  on(eventName: 'event' | 'finished', listener: AnyListener): this {
    const wrappedListener: WrappedListener = (e: Event) => {
      if (e.type === 'event') {
        (listener as EventListener)((e as CustomEvent<AgentExecutionEvent>).detail);
      } else {
        (listener as FinishedListener)();
      }
    };

    const eventListeners = this.listenerMap.get(eventName)!;
    const wrappedListeners = eventListeners.get(listener);
    if (wrappedListeners) {
      wrappedListeners.push(wrappedListener);
    } else {
      eventListeners.set(listener, [wrappedListener]);
    }
    this.addEventListener(eventName, wrappedListener);
    return this;
  }

  /**
   * EventEmitter-compatible 'off' method.
   * Uses the stored wrapped listener for proper removal.
   * Removes one instance at a time (LIFO order, like EventEmitter).
   */
  off(eventName: 'event', listener: EventListener): this;
  off(eventName: 'finished', listener: FinishedListener): this;
  off(eventName: 'event' | 'finished', listener: AnyListener): this {
    const eventListeners = this.listenerMap.get(eventName)!;
    const wrappedListeners = eventListeners.get(listener);
    if (wrappedListeners && wrappedListeners.length > 0) {
      // Remove the most recently added listener (LIFO)
      const wrappedListener = wrappedListeners.pop()!;
      this.removeEventListener(eventName, wrappedListener);
      // Clean up the map entry if no more wrapped listeners
      if (wrappedListeners.length === 0) {
        eventListeners.delete(listener);
      }
    }
    return this;
  }

  /**
   * EventEmitter-compatible 'once' method.
   * Listener is automatically removed after first invocation.
   * Supports multiple registrations of the same listener (like EventEmitter).
   */
  once(eventName: 'event', listener: EventListener): this;
  once(eventName: 'finished', listener: FinishedListener): this;
  once(eventName: 'event' | 'finished', listener: AnyListener): this {
    const eventListeners = this.listenerMap.get(eventName)!;

    const wrappedListener: WrappedListener = (e: Event) => {
      // Clean up tracking for this specific wrapped listener
      const wrappedListeners = eventListeners.get(listener);
      if (wrappedListeners) {
        const index = wrappedListeners.indexOf(wrappedListener);
        if (index !== -1) {
          wrappedListeners.splice(index, 1);
        }
        if (wrappedListeners.length === 0) {
          eventListeners.delete(listener);
        }
      }

      if (e.type === 'event') {
        (listener as EventListener)((e as CustomEvent<AgentExecutionEvent>).detail);
      } else {
        (listener as FinishedListener)();
      }
    };

    const wrappedListeners = eventListeners.get(listener);
    if (wrappedListeners) {
      wrappedListeners.push(wrappedListener);
    } else {
      eventListeners.set(listener, [wrappedListener]);
    }
    this.addEventListener(eventName, wrappedListener, { once: true });
    return this;
  }

  /**
   * EventEmitter-compatible 'removeAllListeners' method.
   * Removes all listeners for a specific event or all events.
   */
  removeAllListeners(eventName?: 'event' | 'finished'): this {
    const eventsToClean: Array<'event' | 'finished'> = eventName
      ? [eventName]
      : ['event', 'finished'];

    for (const event of eventsToClean) {
      const eventListeners = this.listenerMap.get(event);
      if (eventListeners) {
        for (const [, wrappedListeners] of eventListeners) {
          for (const wrappedListener of wrappedListeners) {
            this.removeEventListener(event, wrappedListener);
          }
        }
        eventListeners.clear();
      }
    }
    return this;
  }
}

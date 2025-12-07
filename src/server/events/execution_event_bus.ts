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
 * Type for wrapped listener functions stored in WeakMap
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
 * This replaces Node.js EventEmitter to enable edge runtime compatibility.
 *
 * Note: Listeners registered with `once()` are tracked until the event fires or they are
 * explicitly removed via `off()` or `removeAllListeners()`. This matches the behavior of
 * Node.js EventEmitter. In long-running applications, ensure events eventually fire or
 * explicitly clean up listeners that are no longer needed.
 */
export class DefaultExecutionEventBus extends EventTarget implements ExecutionEventBus {
  // Track original listeners to their wrapped versions for proper removal
  private listenerMap: WeakMap<AnyListener, WrappedListener> = new WeakMap();
  // Track all listeners for removeAllListeners support
  private allListeners: Map<string, Set<AnyListener>> = new Map();

  constructor() {
    super();
    this.allListeners.set('event', new Set());
    this.allListeners.set('finished', new Set());
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
   */
  on(eventName: 'event', listener: EventListener): this;
  on(eventName: 'finished', listener: FinishedListener): this;
  on(eventName: 'event' | 'finished', listener: AnyListener): this {
    const wrappedListener: WrappedListener = (e: Event) => {
      if ('detail' in e) {
        (listener as EventListener)((e as CustomEvent<AgentExecutionEvent>).detail);
      } else {
        (listener as FinishedListener)();
      }
    };

    this.listenerMap.set(listener, wrappedListener);
    this.allListeners.get(eventName)?.add(listener);
    this.addEventListener(eventName, wrappedListener);
    return this;
  }

  /**
   * EventEmitter-compatible 'off' method.
   * Uses the stored wrapped listener for proper removal.
   */
  off(eventName: 'event', listener: EventListener): this;
  off(eventName: 'finished', listener: FinishedListener): this;
  off(eventName: 'event' | 'finished', listener: AnyListener): this {
    const wrappedListener = this.listenerMap.get(listener);
    if (wrappedListener) {
      this.removeEventListener(eventName, wrappedListener);
      this.listenerMap.delete(listener);
      this.allListeners.get(eventName)?.delete(listener);
    }
    return this;
  }

  /**
   * EventEmitter-compatible 'once' method.
   * Listener is automatically removed after first invocation.
   */
  once(eventName: 'event', listener: EventListener): this;
  once(eventName: 'finished', listener: FinishedListener): this;
  once(eventName: 'event' | 'finished', listener: AnyListener): this {
    const wrappedListener: WrappedListener = (e: Event) => {
      // Clean up tracking
      this.listenerMap.delete(listener);
      this.allListeners.get(eventName)?.delete(listener);

      if ('detail' in e) {
        (listener as EventListener)((e as CustomEvent<AgentExecutionEvent>).detail);
      } else {
        (listener as FinishedListener)();
      }
    };

    this.listenerMap.set(listener, wrappedListener);
    this.allListeners.get(eventName)?.add(listener);
    this.addEventListener(eventName, wrappedListener, { once: true });
    return this;
  }

  /**
   * EventEmitter-compatible 'removeAllListeners' method.
   * Removes all listeners for a specific event or all events.
   */
  removeAllListeners(eventName?: 'event' | 'finished'): this {
    const eventsToClean = eventName ? [eventName] : ['event', 'finished'];

    for (const event of eventsToClean) {
      const listeners = this.allListeners.get(event);
      if (listeners) {
        for (const listener of listeners) {
          const wrappedListener = this.listenerMap.get(listener);
          if (wrappedListener) {
            this.removeEventListener(event, wrappedListener);
            this.listenerMap.delete(listener);
          }
        }
        listeners.clear();
      }
    }
    return this;
  }
}

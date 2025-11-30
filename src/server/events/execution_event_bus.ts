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
 */
const CustomEventImpl: typeof CustomEvent =
  typeof CustomEvent !== 'undefined'
    ? CustomEvent
    : (class CustomEventPolyfill<T> extends Event {
        readonly detail: T;
        constructor(type: string, eventInitDict?: CustomEventInit<T>) {
          super(type, eventInitDict);
          this.detail = eventInitDict?.detail as T;
        }
      } as typeof CustomEvent);

/**
 * Type for wrapped listener functions stored in WeakMap
 */
type WrappedListener = (e: Event) => void;

/**
 * Web-compatible ExecutionEventBus using EventTarget.
 * Works across all modern runtimes: Node.js 15+, browsers, Cloudflare Workers, Deno, Bun.
 *
 * This replaces Node.js EventEmitter to enable edge runtime compatibility.
 */
export class DefaultExecutionEventBus extends EventTarget implements ExecutionEventBus {
  // Track original listeners to their wrapped versions for proper removal
  private listenerMap: WeakMap<(event: AgentExecutionEvent) => void, WrappedListener> =
    new WeakMap();
  // Track all listeners for removeAllListeners support
  private allListeners: Map<string, Set<(event: AgentExecutionEvent) => void>> = new Map();

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
  on(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this {
    const wrappedListener: WrappedListener = (e: Event) => {
      if ('detail' in e) {
        listener((e as CustomEvent<AgentExecutionEvent>).detail);
      } else {
        // 'finished' event has no payload - call listener with no arguments
        (listener as () => void)();
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
  off(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this {
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
  once(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this {
    const wrappedListener: WrappedListener = (e: Event) => {
      // Clean up tracking
      this.listenerMap.delete(listener);
      this.allListeners.get(eventName)?.delete(listener);

      if ('detail' in e) {
        listener((e as CustomEvent<AgentExecutionEvent>).detail);
      } else {
        // 'finished' event has no payload - call listener with no arguments
        (listener as () => void)();
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

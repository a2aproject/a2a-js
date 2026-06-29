import { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '../../index.js';

/**
 * Discriminant values for {@link AgentExecutionEvent}. Mirror
 * `StreamResponse.payload.$case` values for trivial conversion.
 */
export type AgentExecutionEventKind = 'message' | 'task' | 'statusUpdate' | 'artifactUpdate';

/**
 * Discriminated union wrapper for agent execution events. The `kind`
 * property is the TypeScript discriminant, enabling exhaustive
 * `switch`/`case` narrowing without unsafe casts.
 */
export type AgentExecutionEvent =
  | { kind: 'message'; data: Message }
  | { kind: 'task'; data: Task }
  | { kind: 'statusUpdate'; data: TaskStatusUpdateEvent }
  | { kind: 'artifactUpdate'; data: TaskArtifactUpdateEvent };

/**
 * Factory functions for type-safe {@link AgentExecutionEvent} wrappers.
 * Prefer these over constructing the wrapper object literals directly.
 *
 * @example
 * ```ts
 * eventBus.publish(AgentEvent.task({ id: '...', contextId: '...', ... }));
 * eventBus.publish(AgentEvent.statusUpdate({ taskId: '...', status: { ... }, ... }));
 * ```
 */
export const AgentEvent = {
  message: (data: Message): AgentExecutionEvent => ({ kind: 'message', data }),
  task: (data: Task): AgentExecutionEvent => ({ kind: 'task', data }),
  statusUpdate: (data: TaskStatusUpdateEvent): AgentExecutionEvent => ({
    kind: 'statusUpdate',
    data,
  }),
  artifactUpdate: (data: TaskArtifactUpdateEvent): AgentExecutionEvent => ({
    kind: 'artifactUpdate',
    data,
  }),
} as const;

/**
 * Compile-time exhaustiveness guard for `switch (event.kind)`. Place in
 * the `default` branch: adding a new kind without handling it produces a
 * TypeScript error.
 */
export function assertUnreachableEvent(event: never): never {
  throw new Error(`Unhandled event kind: ${(event as AgentExecutionEvent).kind}`);
}

/** Event names supported by {@link ExecutionEventBus}. */
export type ExecutionEventName = 'event' | 'finished';

/** Listener for `'event'` notifications, invoked with the published event. */
export type EventListener = (event: AgentExecutionEvent) => void;

/** Listener for `'finished'` notifications, invoked with no arguments. */
export type FinishedListener = () => void;

export interface ExecutionEventBus {
  publish(event: AgentExecutionEvent): void;
  on(eventName: 'event', listener: EventListener): this;
  on(eventName: 'finished', listener: FinishedListener): this;
  off(eventName: 'event', listener: EventListener): this;
  off(eventName: 'finished', listener: FinishedListener): this;
  once(eventName: 'event', listener: EventListener): this;
  once(eventName: 'finished', listener: FinishedListener): this;
  removeAllListeners(eventName?: ExecutionEventName): this;
  finished(): void;
}

// CustomEvent polyfill for Node.js 15–18 (added globally in 19). Browsers
// and modern edge runtimes already expose CustomEvent.
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

type WrappedListener = (e: Event) => void;

// Should always pass for 'event' type events since we control the dispatch
// via publish(). If it fails, there's a bug in the implementation.
function isAgentExecutionCustomEvent(e: Event): e is CustomEvent<AgentExecutionEvent> {
  return e instanceof CustomEventImpl;
}

/**
 * Web-compatible {@link ExecutionEventBus} backed by `EventTarget`. Works
 * on Node 15+, browsers, Cloudflare Workers, Deno, and Bun.
 *
 * Implements only the subset of `EventEmitter` methods declared on
 * {@link ExecutionEventBus}; subclassers should note that
 * `listenerCount`, `rawListeners`, etc. are not available.
 */
export class DefaultExecutionEventBus extends EventTarget implements ExecutionEventBus {
  // Separate storage so each event type can hold listeners of its own
  // signature: 'event' listeners receive a payload, 'finished' listeners
  // are invoked with no arguments.
  private readonly eventListeners: Map<EventListener, WrappedListener[]> = new Map();
  private readonly finishedListeners: Map<FinishedListener, WrappedListener[]> = new Map();

  publish(event: AgentExecutionEvent): void {
    this.dispatchEvent(new CustomEventImpl('event', { detail: event }));
  }

  finished(): void {
    this.dispatchEvent(new Event('finished'));
  }

  on(eventName: 'event', listener: EventListener): this;
  on(eventName: 'finished', listener: FinishedListener): this;
  on(eventName: ExecutionEventName, listener: EventListener | FinishedListener): this {
    if (eventName === 'event') {
      this.addEventListenerInternal(listener as EventListener);
    } else {
      this.addFinishedListenerInternal(listener as FinishedListener);
    }
    return this;
  }

  off(eventName: 'event', listener: EventListener): this;
  off(eventName: 'finished', listener: FinishedListener): this;
  off(eventName: ExecutionEventName, listener: EventListener | FinishedListener): this {
    if (eventName === 'event') {
      this.removeEventListenerInternal(listener as EventListener);
    } else {
      this.removeFinishedListenerInternal(listener as FinishedListener);
    }
    return this;
  }

  once(eventName: 'event', listener: EventListener): this;
  once(eventName: 'finished', listener: FinishedListener): this;
  once(eventName: ExecutionEventName, listener: EventListener | FinishedListener): this {
    if (eventName === 'event') {
      this.addEventListenerOnceInternal(listener as EventListener);
    } else {
      this.addFinishedListenerOnceInternal(listener as FinishedListener);
    }
    return this;
  }

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

  // Listener tracking helpers.

  private trackListener<L>(
    listenerMap: Map<L, WrappedListener[]>,
    listener: L,
    wrapped: WrappedListener
  ): void {
    const existing = listenerMap.get(listener);
    if (existing) {
      existing.push(wrapped);
    } else {
      listenerMap.set(listener, [wrapped]);
    }
  }

  private untrackWrappedListener<L>(
    listenerMap: Map<L, WrappedListener[]>,
    listener: L,
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

  // 'event' listeners.

  private addEventListenerInternal(listener: EventListener): void {
    const wrapped: WrappedListener = (e: Event) => {
      if (!isAgentExecutionCustomEvent(e)) {
        throw new Error('Internal error: expected CustomEvent for "event" type');
      }
      listener.call(this, e.detail);
    };

    this.trackListener(this.eventListeners, listener, wrapped);
    this.addEventListener('event', wrapped);
  }

  private removeEventListenerInternal(listener: EventListener): void {
    const wrappedList = this.eventListeners.get(listener);
    if (wrappedList && wrappedList.length > 0) {
      const wrapped = wrappedList.pop()!;
      if (wrappedList.length === 0) {
        this.eventListeners.delete(listener);
      }
      this.removeEventListener('event', wrapped);
    }
  }

  private addEventListenerOnceInternal(listener: EventListener): void {
    const wrapped: WrappedListener = (e: Event) => {
      if (!isAgentExecutionCustomEvent(e)) {
        throw new Error('Internal error: expected CustomEvent for "event" type');
      }
      this.untrackWrappedListener(this.eventListeners, listener, wrapped);
      listener.call(this, e.detail);
    };

    this.trackListener(this.eventListeners, listener, wrapped);
    this.addEventListener('event', wrapped, { once: true });
  }

  // 'finished' listeners. Invoked with no arguments; the interface
  // declares them as `FinishedListener` so callers get a precise type.

  private addFinishedListenerInternal(listener: FinishedListener): void {
    const wrapped: WrappedListener = () => {
      listener.call(this);
    };

    this.trackListener(this.finishedListeners, listener, wrapped);
    this.addEventListener('finished', wrapped);
  }

  private removeFinishedListenerInternal(listener: FinishedListener): void {
    const wrappedList = this.finishedListeners.get(listener);
    if (wrappedList && wrappedList.length > 0) {
      const wrapped = wrappedList.pop()!;
      if (wrappedList.length === 0) {
        this.finishedListeners.delete(listener);
      }
      this.removeEventListener('finished', wrapped);
    }
  }

  private addFinishedListenerOnceInternal(listener: FinishedListener): void {
    const wrapped: WrappedListener = () => {
      this.untrackWrappedListener(this.finishedListeners, listener, wrapped);
      listener.call(this);
    };

    this.trackListener(this.finishedListeners, listener, wrapped);
    this.addEventListener('finished', wrapped, { once: true });
  }
}

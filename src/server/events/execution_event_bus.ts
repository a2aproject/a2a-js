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

export interface ExecutionEventBus {
  publish(event: AgentExecutionEvent): void;
  on(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this;
  off(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this;
  once(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this;
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

type Listener = (event: AgentExecutionEvent) => void;
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
  // Separate storage for each event type — both use the interface's
  // Listener type but are invoked differently (with event payload vs. no
  // arguments).
  private readonly eventListeners: Map<Listener, WrappedListener[]> = new Map();
  private readonly finishedListeners: Map<Listener, WrappedListener[]> = new Map();

  publish(event: AgentExecutionEvent): void {
    this.dispatchEvent(new CustomEventImpl('event', { detail: event }));
  }

  finished(): void {
    this.dispatchEvent(new Event('finished'));
  }

  on(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this {
    if (eventName === 'event') {
      this.addEventListenerInternal(listener);
    } else {
      this.addFinishedListenerInternal(listener);
    }
    return this;
  }

  off(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this {
    if (eventName === 'event') {
      this.removeEventListenerInternal(listener);
    } else {
      this.removeFinishedListenerInternal(listener);
    }
    return this;
  }

  once(eventName: ExecutionEventName, listener: (event: AgentExecutionEvent) => void): this {
    if (eventName === 'event') {
      this.addEventListenerOnceInternal(listener);
    } else {
      this.addFinishedListenerOnceInternal(listener);
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

  // 'event' listeners.

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
      if (!isAgentExecutionCustomEvent(e)) {
        throw new Error('Internal error: expected CustomEvent for "event" type');
      }
      this.untrackWrappedListener(this.eventListeners, listener, wrapped);
      listener.call(this, e.detail);
    };

    this.trackListener(this.eventListeners, listener, wrapped);
    this.addEventListener('event', wrapped, { once: true });
  }

  // 'finished' listeners. The interface declares listeners as taking an
  // `AgentExecutionEvent`, but for 'finished' they're invoked with no
  // arguments (matching EventEmitter behaviour).

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
      this.untrackWrappedListener(this.finishedListeners, listener, wrapped);
      listener.call(this);
    };

    this.trackListener(this.finishedListeners, listener, wrapped);
    this.addEventListener('finished', wrapped, { once: true });
  }
}

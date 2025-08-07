import { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from "../../types.js";

export type AgentExecutionEvent = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

export interface ExecutionEventBus {
  publish(event: AgentExecutionEvent): void;
  on(eventName: "event" | "finished", listener: (event: AgentExecutionEvent) => void): this;
  off(eventName: "event" | "finished", listener: (event: AgentExecutionEvent) => void): this;
  once(eventName: "event" | "finished", listener: (event: AgentExecutionEvent) => void): this;
  removeAllListeners(eventName?: "event" | "finished"): this;
  finished(): void;
}

type EventListener = (event: AgentExecutionEvent) => void;

export class DefaultExecutionEventBus implements ExecutionEventBus {
  private eventListeners: Map<string, Set<EventListener>> = new Map();

  constructor() {
    this.eventListeners.set("event", new Set());
    this.eventListeners.set("finished", new Set());
  }

  publish(event: AgentExecutionEvent): void {
    const listeners = this.eventListeners.get("event");
    if (listeners) {
      // Create a copy of listeners to avoid issues if listeners are modified during iteration
      const listenersCopy = Array.from(listeners);
      for (const listener of listenersCopy) {
        try {
          listener(event);
        } catch (error) {
          console.error("Error in event listener:", error);
        }
      }
    }
  }

  finished(): void {
    // Emit finished event to 'finished' listeners
    const finishedListeners = this.eventListeners.get("finished");
    if (finishedListeners) {
      const listenersCopy = Array.from(finishedListeners);
      for (const listener of listenersCopy) {
        try {
          // For finished event, we don't pass an event object
          listener({} as AgentExecutionEvent);
        } catch (error) {
          console.error("Error in finished listener:", error);
        }
      }
    }
  }

  on(eventName: "event" | "finished", listener: EventListener): this {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      listeners.add(listener);
    }
    return this;
  }

  off(eventName: "event" | "finished", listener: EventListener): this {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      listeners.delete(listener);
    }
    return this;
  }

  once(eventName: "event" | "finished", listener: EventListener): this {
    const onceWrapper = (event: AgentExecutionEvent) => {
      listener(event);
      this.off(eventName, onceWrapper);
    };
    return this.on(eventName, onceWrapper);
  }

  removeAllListeners(eventName?: "event" | "finished"): this {
    if (eventName) {
      const listeners = this.eventListeners.get(eventName);
      if (listeners) {
        listeners.clear();
      }
    } else {
      // Remove all listeners for all events
      for (const listeners of this.eventListeners.values()) {
        listeners.clear();
      }
    }
    return this;
  }
}

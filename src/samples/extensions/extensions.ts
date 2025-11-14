import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
  AgentExecutionEvent
} from "../../server/index.js";
import { TaskStatusUpdateEvent } from "../../types.js";

const URI = 'https://github.com/a2aproject/a2a-js/src/samples/extensions/v1'

class TimeStampExtension {
  activate(context: RequestContext): boolean {
    const serverContext = context.context;
    if (serverContext?.requestedExtensions?.has(URI)) {
        serverContext.addActivatedExtension(URI);
        return true;
    }
    return false;
  }

  timestampEvent(event: AgentExecutionEvent): void {
    if (event.kind === 'status-update') {
        const statusUpdateEvent = event as TaskStatusUpdateEvent;
        if (statusUpdateEvent.status.message) {
            if (!statusUpdateEvent.status.message.metadata) {
                statusUpdateEvent.status.message.metadata = {};
            }
            statusUpdateEvent.status.message.metadata['timestamp'] = new Date().toISOString();
        }
    }
  }
}

export class TimestampingAgentExecutor implements AgentExecutor {
  private readonly _delegate: AgentExecutor;
  private readonly _ext: TimeStampExtension;

  constructor(delegate: AgentExecutor, ext: TimeStampExtension = new TimeStampExtension()) {
    this._delegate = delegate;
    this._ext = ext;
  }

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    return await this._delegate.execute(
      context,
      this._maybeWrapQueue(context, eventBus)
    );
  }

  _maybeWrapQueue(context: RequestContext, eventBus: ExecutionEventBus): ExecutionEventBus {
    if (this._ext.activate(context)) {
      return new TimestampingEventQueue(eventBus, this._ext);
    }
    return eventBus;
  }

  async cancelTask (
        taskId: string,
        eventBus: ExecutionEventBus
    ): Promise<void> {
    return await this._delegate.cancelTask(taskId, eventBus);
  }
}

class TimestampingEventQueue implements ExecutionEventBus {
    private readonly _delegate: ExecutionEventBus;
    private readonly _ext: TimeStampExtension;

    constructor(delegate: ExecutionEventBus, ext: TimeStampExtension) {
        this._delegate = delegate;
        this._ext = ext;
    }

    publish(event: AgentExecutionEvent): void {
        this._ext.timestampEvent(event);
        this._delegate.publish(event);
    }

    finished(): void {
        this._delegate.finished();
    }

    on(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this{
        this._delegate.on(eventName, listener);
        return this;
    }

    off(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this{
        this._delegate.off(eventName, listener);
        return this;
    }
    
    once(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this{
        this._delegate.once(eventName, listener);
        return this;
    }

    removeAllListeners(eventName?: 'event' | 'finished'): this{
        this._delegate.removeAllListeners(eventName);
        return this;
    }
}
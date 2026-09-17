import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  AgentExecutionEvent,
  EventListener,
  FinishedListener,
} from '../../server/index.js';

export const EXTENSION_URI = 'https://github.com/a2aproject/a2a-js/src/samples/extensions/v1';

class TimeStampExtension {
  activate(context: RequestContext): boolean {
    const serverContext = context.context;
    if (serverContext?.requestedExtensions?.includes(EXTENSION_URI)) {
      serverContext.addActivatedExtension(EXTENSION_URI);
      return true;
    }
    return false;
  }

  timestampEvent(event: AgentExecutionEvent): void {
    if (event.kind === 'statusUpdate') {
      if (event.data.status?.message) {
        if (!event.data.status.message.metadata) {
          event.data.status.message.metadata = {};
        }
        event.data.status.message.metadata['timestamp'] = new Date().toISOString();
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
    return await this._delegate.execute(context, this._maybeWrapQueue(context, eventBus));
  }

  _maybeWrapQueue(context: RequestContext, eventBus: ExecutionEventBus): ExecutionEventBus {
    if (this._ext.activate(context)) {
      return new TimestampingEventQueue(eventBus, this._ext);
    }
    return eventBus;
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
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

  on(eventName: 'event', listener: EventListener): this;
  on(eventName: 'finished', listener: FinishedListener): this;
  on(eventName: 'event' | 'finished', listener: EventListener | FinishedListener): this {
    if (eventName === 'event') {
      this._delegate.on('event', listener as EventListener);
    } else {
      this._delegate.on('finished', listener as FinishedListener);
    }
    return this;
  }

  off(eventName: 'event', listener: EventListener): this;
  off(eventName: 'finished', listener: FinishedListener): this;
  off(eventName: 'event' | 'finished', listener: EventListener | FinishedListener): this {
    if (eventName === 'event') {
      this._delegate.off('event', listener as EventListener);
    } else {
      this._delegate.off('finished', listener as FinishedListener);
    }
    return this;
  }

  once(eventName: 'event', listener: EventListener): this;
  once(eventName: 'finished', listener: FinishedListener): this;
  once(eventName: 'event' | 'finished', listener: EventListener | FinishedListener): this {
    if (eventName === 'event') {
      this._delegate.once('event', listener as EventListener);
    } else {
      this._delegate.once('finished', listener as FinishedListener);
    }
    return this;
  }

  removeAllListeners(eventName?: 'event' | 'finished'): this {
    this._delegate.removeAllListeners(eventName);
    return this;
  }
}

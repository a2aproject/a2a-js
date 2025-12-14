import { describe, it, beforeEach, expect } from 'vitest';

import {
  DefaultExecutionEventBus,
  AgentExecutionEvent,
} from '../../src/server/events/execution_event_bus.js';
import { Message } from '../../src/types.js';

describe('DefaultExecutionEventBus', () => {
  let eventBus: DefaultExecutionEventBus;

  beforeEach(() => {
    eventBus = new DefaultExecutionEventBus();
  });

  const createMessage = (() => {
    let counter = 0;
    return (text: string): Message => ({
      kind: 'message',
      messageId: `msg-${counter++}`,
      role: 'agent',
      parts: [{ kind: 'text', text }],
    });
  })();

  describe('publish and event listeners', () => {
    it('should emit events to listeners registered with on()', () => {
      const receivedEvents: AgentExecutionEvent[] = [];
      const message = createMessage('test');

      eventBus.on('event', (event) => {
        receivedEvents.push(event);
      });

      eventBus.publish(message);

      expect(receivedEvents).to.have.length(1);
      expect(receivedEvents[0]).to.deep.equal(message);
    });

    it('should emit events to multiple listeners in registration order', () => {
      const order: string[] = [];

      eventBus.on('event', () => order.push('first'));
      eventBus.on('event', () => order.push('second'));
      eventBus.on('event', () => order.push('third'));

      eventBus.publish(createMessage('test'));

      expect(order).to.deep.equal(['first', 'second', 'third']);
    });

    it('should support registering the same listener multiple times', () => {
      let callCount = 0;
      const listener = () => {
        callCount++;
      };

      eventBus.on('event', listener);
      eventBus.on('event', listener);
      eventBus.on('event', listener);

      eventBus.publish(createMessage('test'));

      expect(callCount).to.equal(3);
    });
  });

  describe('finished event', () => {
    it('should emit finished event to listeners', () => {
      let finishedCalled = false;

      eventBus.on('finished', () => {
        finishedCalled = true;
      });

      eventBus.finished();

      expect(finishedCalled).to.be.true;
    });

    it('should support multiple finished listeners', () => {
      const order: string[] = [];

      eventBus.on('finished', () => order.push('first'));
      eventBus.on('finished', () => order.push('second'));

      eventBus.finished();

      expect(order).to.deep.equal(['first', 'second']);
    });
  });

  describe('off() - listener removal', () => {
    it('should remove a listener', () => {
      let callCount = 0;
      const listener = () => {
        callCount++;
      };

      eventBus.on('event', listener);
      eventBus.off('event', listener);

      eventBus.publish(createMessage('test'));

      expect(callCount).to.equal(0);
    });

    it('should remove one instance at a time when same listener registered multiple times', () => {
      let callCount = 0;
      const listener = () => {
        callCount++;
      };

      // Register same listener 3 times
      eventBus.on('event', listener);
      eventBus.on('event', listener);
      eventBus.on('event', listener);

      // Remove one instance
      eventBus.off('event', listener);

      eventBus.publish(createMessage('test'));
      expect(callCount).to.equal(2);

      // Remove another instance
      callCount = 0;
      eventBus.off('event', listener);

      eventBus.publish(createMessage('test'));
      expect(callCount).to.equal(1);

      // Remove last instance
      callCount = 0;
      eventBus.off('event', listener);

      eventBus.publish(createMessage('test'));
      expect(callCount).to.equal(0);
    });

    it('should not throw when removing a listener that was never added', () => {
      const listener = () => {};
      expect(() => eventBus.off('event', listener)).to.not.throw();
    });

    it('should not throw when removing a listener that was already removed', () => {
      const listener = () => {};
      eventBus.on('event', listener);
      eventBus.off('event', listener);
      expect(() => eventBus.off('event', listener)).to.not.throw();
    });
  });

  describe('once() - one-time listeners', () => {
    it('should fire listener only once', () => {
      let callCount = 0;

      eventBus.once('event', () => {
        callCount++;
      });

      eventBus.publish(createMessage('test1'));
      eventBus.publish(createMessage('test2'));

      expect(callCount).to.equal(1);
    });

    it('should support multiple once() registrations of same listener', () => {
      let callCount = 0;
      const listener = () => {
        callCount++;
      };

      eventBus.once('event', listener);
      eventBus.once('event', listener);

      // First event should trigger both once listeners
      eventBus.publish(createMessage('test'));
      expect(callCount).to.equal(2);

      // Second event should trigger none
      callCount = 0;
      eventBus.publish(createMessage('test'));
      expect(callCount).to.equal(0);
    });

    it('should allow removal of once() listener before it fires', () => {
      let callCount = 0;
      const listener = () => {
        callCount++;
      };

      eventBus.once('event', listener);
      eventBus.off('event', listener);

      eventBus.publish(createMessage('test'));

      expect(callCount).to.equal(0);
    });

    it('should work correctly for finished event', () => {
      let callCount = 0;

      eventBus.once('finished', () => {
        callCount++;
      });

      eventBus.finished();
      eventBus.finished();

      expect(callCount).to.equal(1);
    });
  });

  describe('removeAllListeners()', () => {
    it('should remove all listeners for a specific event', () => {
      let eventCount = 0;
      let finishedCount = 0;

      eventBus.on('event', () => eventCount++);
      eventBus.on('event', () => eventCount++);
      eventBus.on('finished', () => finishedCount++);

      eventBus.removeAllListeners('event');

      eventBus.publish(createMessage('test'));
      eventBus.finished();

      expect(eventCount).to.equal(0);
      expect(finishedCount).to.equal(1);
    });

    it('should remove all listeners for all events when called without argument', () => {
      let eventCount = 0;
      let finishedCount = 0;

      eventBus.on('event', () => eventCount++);
      eventBus.on('finished', () => finishedCount++);

      eventBus.removeAllListeners();

      eventBus.publish(createMessage('test'));
      eventBus.finished();

      expect(eventCount).to.equal(0);
      expect(finishedCount).to.equal(0);
    });

    it('should remove all instances of multiply-registered listeners', () => {
      let callCount = 0;
      const listener = () => callCount++;

      eventBus.on('event', listener);
      eventBus.on('event', listener);
      eventBus.on('event', listener);

      eventBus.removeAllListeners('event');

      eventBus.publish(createMessage('test'));

      expect(callCount).to.equal(0);
    });

    it('should remove once() listeners that have not fired', () => {
      let callCount = 0;

      eventBus.once('event', () => callCount++);
      eventBus.once('event', () => callCount++);

      eventBus.removeAllListeners('event');

      eventBus.publish(createMessage('test'));

      expect(callCount).to.equal(0);
    });
  });

  describe('mixed on() and once() usage', () => {
    it('should handle mix of on() and once() listeners correctly', () => {
      const order: string[] = [];

      eventBus.on('event', () => order.push('on-1'));
      eventBus.once('event', () => order.push('once-1'));
      eventBus.on('event', () => order.push('on-2'));
      eventBus.once('event', () => order.push('once-2'));

      // First emit
      eventBus.publish(createMessage('test'));
      expect(order).to.deep.equal(['on-1', 'once-1', 'on-2', 'once-2']);

      // Second emit - only on() listeners should fire
      order.length = 0;
      eventBus.publish(createMessage('test'));
      expect(order).to.deep.equal(['on-1', 'on-2']);
    });
  });

  describe('chaining', () => {
    it('should return this from on() for chaining', () => {
      const result = eventBus.on('event', () => {});
      expect(result).to.equal(eventBus);
    });

    it('should return this from off() for chaining', () => {
      const listener = () => {};
      eventBus.on('event', listener);
      const result = eventBus.off('event', listener);
      expect(result).to.equal(eventBus);
    });

    it('should return this from once() for chaining', () => {
      const result = eventBus.once('event', () => {});
      expect(result).to.equal(eventBus);
    });

    it('should return this from removeAllListeners() for chaining', () => {
      const result = eventBus.removeAllListeners();
      expect(result).to.equal(eventBus);
    });

    it('should support method chaining', () => {
      let count = 0;
      const listener = () => count++;

      eventBus.on('event', listener).on('event', listener).once('event', listener);

      eventBus.publish(createMessage('test'));
      expect(count).to.equal(3);
    });
  });

  describe('this context', () => {
    // Helper to capture `this` without triggering no-this-alias lint rule
    function createThisCapture(): { value: unknown; capture: () => void } {
      const result: { value: unknown; capture: () => void } = {
        value: undefined,
        capture: function (this: unknown) {
          result.value = this;
        },
      };
      return result;
    }

    it('should bind this to the event bus for on() event listeners', () => {
      const thisCapture = createThisCapture();
      eventBus.on('event', thisCapture.capture);

      eventBus.publish(createMessage('test'));

      expect(thisCapture.value).to.equal(eventBus);
    });

    it('should bind this to the event bus for on() finished listeners', () => {
      const thisCapture = createThisCapture();
      eventBus.on('finished', thisCapture.capture);

      eventBus.finished();

      expect(thisCapture.value).to.equal(eventBus);
    });

    it('should bind this to the event bus for once() event listeners', () => {
      const thisCapture = createThisCapture();
      eventBus.once('event', thisCapture.capture);

      eventBus.publish(createMessage('test'));

      expect(thisCapture.value).to.equal(eventBus);
    });

    it('should bind this to the event bus for once() finished listeners', () => {
      const thisCapture = createThisCapture();
      eventBus.once('finished', thisCapture.capture);

      eventBus.finished();

      expect(thisCapture.value).to.equal(eventBus);
    });
  });

  describe('listener errors', () => {
    async function captureUncaughtException(run: () => void): Promise<void> {
      // Node's EventTarget reports listener errors as an uncaught exception on nextTick.
      // We attach a temporary handler to prevent vitest from failing the run.
      let handlerCalled = false;
      const handler = () => {
        handlerCalled = true;
      };

      // Use the real Node global when available (no casts); `typeof` is safe even if `process` is missing.
      const nodeProcess = typeof process !== 'undefined' ? process : undefined;
      if (nodeProcess) {
        nodeProcess.once('uncaughtException', handler);
      }

      run();

      // Give Node a tick to surface the uncaught exception (if any), then clean up.
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (!handlerCalled && nodeProcess) {
        nodeProcess.removeListener('uncaughtException', handler);
      }
    }

    it('should continue calling other event listeners when one throws', async () => {
      let secondCalled = false;

      await captureUncaughtException(() => {
        eventBus.on('event', () => {
          throw new Error('listener error');
        });
        eventBus.on('event', () => {
          secondCalled = true;
        });

        eventBus.publish(createMessage('test'));
      });

      expect(secondCalled).to.equal(true);
    });

    it('should continue calling other finished listeners when one throws', async () => {
      let secondCalled = false;

      await captureUncaughtException(() => {
        eventBus.on('finished', () => {
          throw new Error('listener error');
        });
        eventBus.on('finished', () => {
          secondCalled = true;
        });

        eventBus.finished();
      });

      expect(secondCalled).to.equal(true);
    });
  });
});

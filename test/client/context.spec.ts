import { describe, it, expect } from 'vitest';
import { ClientCallContext, ClientCallContextKey } from '../../src/client/context.js';

describe('ClientCallContext', () => {
  const testKey = new ClientCallContextKey<string>('My key');

  it('should create new context', () => {
    const context = ClientCallContext.create(testKey.set('example-value'));
    expect(testKey.get(context)).to.be.equal('example-value');
  });

  it('should create context from existing', () => {
    const existingContext = ClientCallContext.createFrom(undefined, testKey.set('example-value'));
    const context = ClientCallContext.createFrom(existingContext, testKey.set('new-value'));
    expect(testKey.get(context)).to.be.equal('new-value');
  });
});

describe('ClientCallContextKey', () => {
  it('should be unique', () => {
    const key1 = new ClientCallContextKey<string>('My key');
    const key2 = new ClientCallContextKey<string>('My key');
    expect(key1.symbol).to.not.equal(key2.symbol);
    const context = ClientCallContext.create(key1.set('key1-value'), key2.set('key2-value'));
    expect(key1.get(context)).to.be.equal('key1-value');
    expect(key2.get(context)).to.be.equal('key2-value');
  });
});

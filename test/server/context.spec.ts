import { describe, it, expect } from 'vitest';

import { ServerCallContext } from '../../src/server/context.js';

describe('ServerCallContext.setRequestedExtensions', () => {
  it('mutates the existing instance so an alias held elsewhere observes later activations', () => {
    // Regression guard for the §3.3.4 / §14.2.2 echo bug:
    // `_createRequestContext` previously replaced the context with a fresh
    // instance after filtering requested extensions. The Express / gRPC
    // transport layer held a reference to the original, so
    // `addActivatedExtension(...)` calls from the executor landed on an
    // orphaned object and the `A2A-Extensions` response header was never
    // populated. `aliasHeldByTransport` simulates that retained reference —
    // it MUST observe both the narrowed requested set and any subsequent
    // activations.
    const ctx = new ServerCallContext({
      requestedExtensions: ['ext-a', 'ext-b', 'ext-c'],
      tenant: 't1',
      requestedVersion: '1.0',
    });
    const aliasHeldByTransport = ctx;

    ctx.setRequestedExtensions(['ext-a', 'ext-c']);
    ctx.addActivatedExtension('ext-a');

    expect(aliasHeldByTransport.requestedExtensions).toEqual(['ext-a', 'ext-c']);
    expect(aliasHeldByTransport.activatedExtensions).toEqual(['ext-a']);
    expect(aliasHeldByTransport.tenant).toBe('t1');
    expect(aliasHeldByTransport.requestedVersion).toBe('1.0');
  });
});

import { describe, it, expect } from 'vitest';

import { ServerCallContext } from '../../src/server/context.js';

describe('ServerCallContext.setRequestedExtensions', () => {
  it('mutates the existing instance so an alias held elsewhere observes later activations', () => {
    // Regression guard for the response-header echo bug:
    // `_createRequestContext` previously replaced the context with a fresh
    // instance after narrowing requested extensions (the "SHOULD ignore"
    // rule for unknown extensions). The Express / gRPC transport layer
    // held a reference to the original, so `addActivatedExtension(...)`
    // calls from the executor landed on an orphaned object and the
    // response-side `A2A-Extensions` echo emitted nothing.
    // `aliasHeldByTransport` simulates that retained reference — it MUST
    // observe both the narrowed requested set and any subsequent
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

  it('accepts `undefined` to reset the requested set back to its initial unset state', () => {
    // `_requestedExtensions` is `Extensions | undefined`, so the setter
    // must accept `undefined` — otherwise a caller can never restore
    // the field to its "no header was sent" state.
    const ctx = new ServerCallContext({ requestedExtensions: ['ext-a'] });
    ctx.setRequestedExtensions(undefined);
    expect(ctx.requestedExtensions).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import {
  ServerCallContext,
  defaultServerCallContextBuilder,
  STATE_HEADERS_KEY,
  RequestHeaders,
} from '../../src/server/context.js';
import { Extensions } from '../../src/extensions.js';
import { UnauthenticatedUser } from '../../src/server/authentication/user.js';

describe('ServerCallContext', () => {
  describe('constructor', () => {
    it('initializes with no arguments', () => {
      const ctx = new ServerCallContext();
      expect(ctx.user).toBeUndefined();
      expect(ctx.requestedExtensions).toBeUndefined();
      expect(ctx.activatedExtensions).toBeUndefined();
      expect(ctx.state).toBeInstanceOf(Map);
      expect(ctx.state.size).toBe(0);
    });

    it('stores requestedExtensions and user', () => {
      const user = new UnauthenticatedUser();
      const extensions = Extensions.parseServiceParameter('ext1,ext2');
      const ctx = new ServerCallContext({ requestedExtensions: extensions, user });
      expect(ctx.user).toBe(user);
      expect(ctx.requestedExtensions).toBe(extensions);
    });

    it('uses provided state map', () => {
      const state = new Map<string, unknown>([['key', 'value']]);
      const ctx = new ServerCallContext({ state });
      expect(ctx.state.get('key')).toBe('value');
    });

    it('stores tenant', () => {
      const ctx = new ServerCallContext({ tenant: 'acme' });
      expect(ctx.tenant).toBe('acme');
    });

    it('tenant is undefined when not provided', () => {
      const ctx = new ServerCallContext();
      expect(ctx.tenant).toBeUndefined();
    });

    it('stores requestedVersion', () => {
      const ctx = new ServerCallContext({ requestedVersion: '1.0' });
      expect(ctx.requestedVersion).toBe('1.0');
    });

    it('defaults requestedVersion to 0.3 when absent', () => {
      const ctx = new ServerCallContext();
      expect(ctx.requestedVersion).toBe('0.3');
    });
  });

  describe('addActivatedExtension', () => {
    it('adds a single extension', () => {
      const ctx = new ServerCallContext();
      ctx.addActivatedExtension('ext://foo');
      expect(Array.from(ctx.activatedExtensions!)).toContain('ext://foo');
    });

    it('accumulates multiple extensions', () => {
      const ctx = new ServerCallContext();
      ctx.addActivatedExtension('ext://foo');
      ctx.addActivatedExtension('ext://bar');
      expect(Array.from(ctx.activatedExtensions!)).toEqual(['ext://foo', 'ext://bar']);
    });
  });

  describe('setRequestedExtensions', () => {
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
});

describe('defaultServerCallContextBuilder', () => {
  it('stores headers in state under STATE_HEADERS_KEY', () => {
    const headers: RequestHeaders = { 'x-tenant-id': 'tenant-1', authorization: 'Bearer tok' };
    const ctx = defaultServerCallContextBuilder({
      extensions: undefined,
      user: undefined,
      headers,
    });
    expect(ctx.state.get(STATE_HEADERS_KEY)).toBe(headers);
  });

  it('sets requestedExtensions from the first argument', () => {
    const extensions = Extensions.parseServiceParameter('ext://foo');
    const ctx = defaultServerCallContextBuilder({ extensions, user: undefined, headers: {} });
    expect(Array.from(ctx.requestedExtensions!)).toEqual(Array.from(extensions));
  });

  it('sets user from the second argument', () => {
    const user = new UnauthenticatedUser();
    const ctx = defaultServerCallContextBuilder({ extensions: undefined, user, headers: {} });
    expect(ctx.user).toBe(user);
  });

  it('produces an empty state entry for empty headers', () => {
    const ctx = defaultServerCallContextBuilder({
      extensions: undefined,
      user: undefined,
      headers: {},
    });
    expect(ctx.state.get(STATE_HEADERS_KEY)).toEqual({});
  });

  it('passes tenant to the context', () => {
    const ctx = defaultServerCallContextBuilder({
      extensions: undefined,
      user: undefined,
      headers: {},
      tenant: 'acme',
    });
    expect(ctx.tenant).toBe('acme');
  });

  it('tenant is undefined when not provided', () => {
    const ctx = defaultServerCallContextBuilder({
      extensions: undefined,
      user: undefined,
      headers: {},
    });
    expect(ctx.tenant).toBeUndefined();
  });

  it('passes requestedVersion to the context', () => {
    const ctx = defaultServerCallContextBuilder({
      extensions: undefined,
      user: undefined,
      headers: {},
      requestedVersion: '1.0',
    });
    expect(ctx.requestedVersion).toBe('1.0');
  });

  it('defaults requestedVersion to 0.3 when not provided', () => {
    const ctx = defaultServerCallContextBuilder({
      extensions: undefined,
      user: undefined,
      headers: {},
    });
    expect(ctx.requestedVersion).toBe('0.3');
  });
});

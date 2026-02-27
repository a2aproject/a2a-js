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
      const ctx = new ServerCallContext(extensions, user);
      expect(ctx.user).toBe(user);
      expect(ctx.requestedExtensions).toBe(extensions);
    });

    it('uses provided state map', () => {
      const state = new Map<string, unknown>([['key', 'value']]);
      const ctx = new ServerCallContext(undefined, undefined, state);
      expect(ctx.state.get('key')).toBe('value');
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

  describe('withRequestedExtensions', () => {
    it('returns a new context with the given extensions', () => {
      const user = new UnauthenticatedUser();
      const original = new ServerCallContext(Extensions.parseServiceParameter('ext://old'), user);
      const newExts = Extensions.parseServiceParameter('ext://new');
      const next = original.withRequestedExtensions(newExts);

      expect(next).not.toBe(original);
      expect(Array.from(next.requestedExtensions!)).toEqual(Array.from(newExts));
    });

    it('preserves user', () => {
      const user = new UnauthenticatedUser();
      const ctx = new ServerCallContext(undefined, user);
      const next = ctx.withRequestedExtensions(Extensions.parseServiceParameter('ext://x'));
      expect(next.user).toBe(user);
    });

    it('preserves state entries', () => {
      const state = new Map<string, unknown>([['token', 'abc']]);
      const ctx = new ServerCallContext(undefined, undefined, state);
      const next = ctx.withRequestedExtensions(Extensions.parseServiceParameter('ext://x'));
      expect(next.state.get('token')).toBe('abc');
    });

    it('returns an independent copy of state', () => {
      const ctx = new ServerCallContext(undefined, undefined, new Map<string, unknown>([['k', 1]]));
      const next = ctx.withRequestedExtensions(Extensions.parseServiceParameter('ext://x'));
      next.state.set('k', 99);
      expect(ctx.state.get('k')).toBe(1);
    });

    it('carries over activatedExtensions', () => {
      const ctx = new ServerCallContext();
      ctx.addActivatedExtension('ext://activated');
      const next = ctx.withRequestedExtensions(Extensions.parseServiceParameter('ext://new'));
      expect(Array.from(next.activatedExtensions!)).toContain('ext://activated');
    });
  });
});

describe('defaultServerCallContextBuilder', () => {
  it('stores headers in state under STATE_HEADERS_KEY', () => {
    const headers: RequestHeaders = { 'x-tenant-id': 'tenant-1', authorization: 'Bearer tok' };
    const ctx = defaultServerCallContextBuilder(undefined, undefined, headers);
    expect(ctx.state.get(STATE_HEADERS_KEY)).toBe(headers);
  });

  it('sets requestedExtensions from the first argument', () => {
    const extensions = Extensions.parseServiceParameter('ext://foo');
    const ctx = defaultServerCallContextBuilder(extensions, undefined, {});
    expect(Array.from(ctx.requestedExtensions!)).toEqual(Array.from(extensions));
  });

  it('sets user from the second argument', () => {
    const user = new UnauthenticatedUser();
    const ctx = defaultServerCallContextBuilder(undefined, user, {});
    expect(ctx.user).toBe(user);
  });

  it('produces an empty state entry for empty headers', () => {
    const ctx = defaultServerCallContextBuilder(undefined, undefined, {});
    expect(ctx.state.get(STATE_HEADERS_KEY)).toEqual({});
  });
});

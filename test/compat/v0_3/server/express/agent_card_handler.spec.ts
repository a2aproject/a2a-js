import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { assert, describe, it } from 'vitest';

import { agentCardHandler } from '../../../../../src/server/express/agent_card_handler.js';
import { legacyAgentCardRouter } from '../../../../../src/compat/v0_3/server/express/agent_card_handler.js';
import type { AgentCard } from '../../../../../src/index.js';

/**
 * Agent card with a single v0.3 JSONRPC interface so
 * `toCompatAgentCard` produces a valid legacy card.
 */
function legacyOnlyCard(): AgentCard {
  return {
    name: 'Test Agent',
    description: 'A test agent',
    version: '1.0.0',
    provider: { url: 'https://example.com', organization: 'Test Org' },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    securitySchemes: {},
    securityRequirements: [],
    signatures: [],
    supportedInterfaces: [
      {
        url: 'https://api.example/a2a',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '0.3',
      },
    ],
    capabilities: {
      extensions: [],
      streaming: true,
      pushNotifications: false,
    },
  };
}

/**
 * Agent card with both a v0.3 and a v1.0 interface so the same card
 * can be served at both protocol versions.
 */
function dualVersionCard(): AgentCard {
  return {
    name: 'Test Agent',
    description: 'A test agent',
    version: '1.0.0',
    provider: { url: 'https://example.com', organization: 'Test Org' },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    securitySchemes: {},
    securityRequirements: [],
    signatures: [],
    supportedInterfaces: [
      {
        url: 'https://api.example/v1',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: 'https://api.example/legacy',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '0.3',
      },
    ],
    capabilities: {
      extensions: [],
      streaming: true,
      pushNotifications: false,
    },
  };
}

/**
 * Agent card with NO v0.3 interface — `toCompatAgentCard` must throw
 * `VersionNotSupportedError`, which the handler converts to HTTP 400.
 */
function modernOnlyCard(): AgentCard {
  return {
    name: 'Test Agent',
    description: 'A test agent',
    version: '1.0.0',
    provider: { url: 'https://example.com', organization: 'Test Org' },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    securitySchemes: {},
    securityRequirements: [],
    signatures: [],
    supportedInterfaces: [
      {
        url: 'https://api.example/v1',
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      extensions: [],
      streaming: true,
      pushNotifications: false,
    },
  };
}

function createApp(card: AgentCard, legacyCompat?: { enabled: boolean }) {
  const app = express();
  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({
      agentCardProvider: async () => card,
      legacyCompat,
    })
  );
  return app;
}

/**
 * Mounts a tiny pre-middleware that stamps `Vary: Accept-Encoding` so
 * tests can assert that the handlers' `Vary` write merges into (rather
 * than overwrites) upstream values — emulating what compression/CORS
 * middleware would do in a real deployment.
 */
function createAppWithUpstreamVary(card: AgentCard, legacyCompat?: { enabled: boolean }) {
  const app = express();
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Vary', 'Accept-Encoding');
    next();
  });
  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({
      agentCardProvider: async () => card,
      legacyCompat,
    })
  );
  return app;
}

function createLegacyOnlyApp(card: AgentCard) {
  // Mount only the legacy router for tests that need to exercise the
  // legacy code path in isolation.
  const app = express();
  app.use(
    '/.well-known/agent-card.json',
    legacyAgentCardRouter({ agentCardProvider: async () => card })
  );
  return app;
}

describe('agentCardHandler with legacyCompat', () => {
  describe('header-based dispatch', () => {
    it('serves a hybrid card on header-less requests (v0.3 fields + embedded v1.0 supportedInterfaces)', async () => {
      const app = createApp(dualVersionCard(), { enabled: true });
      const response = await request(app).get('/.well-known/agent-card.json').expect(200);

      // The legacy router emits a "superset" document: v0.3 top-level
      // fields (url / preferredTransport / additionalInterfaces /
      // protocolVersion) for v0.3 parsers, AND the source v1.0
      // `supportedInterfaces[]` for v1.0 parsers that didn't send
      // `A2A-Version: 1.0`. The two field sets are disjoint.
      assert.equal(response.body.name, 'Test Agent');
      assert.equal(response.body.url, 'https://api.example/legacy');
      assert.equal(response.body.preferredTransport, 'JSONRPC');
      assert.equal(response.body.protocolVersion, '0.3');
      assert.isArray(response.body.supportedInterfaces);
      assert.deepEqual(response.body.supportedInterfaces, dualVersionCard().supportedInterfaces);
    });

    it('serves a v0.3 card on explicit A2A-Version: 0.3', async () => {
      const app = createApp(dualVersionCard(), { enabled: true });
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(200);

      assert.equal(response.body.url, 'https://api.example/legacy');
      assert.equal(response.body.protocolVersion, '0.3');
    });

    it('serves the modern v1.0 card on explicit A2A-Version: 1.0', async () => {
      const app = createApp(dualVersionCard(), { enabled: true });
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '1.0')
        .expect(200);

      // v1.0 card preserves the `supportedInterfaces` array and no
      // top-level `url`/`preferredTransport`.
      assert.isArray(response.body.supportedInterfaces);
      assert.equal(response.body.supportedInterfaces.length, 2);
      assert.isUndefined(response.body.url);
      assert.isUndefined(response.body.preferredTransport);
    });

    it('serves the modern v1.0 card on a non-legacy version > 1.0', async () => {
      const app = createApp(dualVersionCard(), { enabled: true });
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '2.0')
        .expect(200);

      // Anything outside `[0.3, 1.0)` falls through to v1.0.
      assert.isArray(response.body.supportedInterfaces);
    });
  });

  describe('caching headers', () => {
    it('sets Vary: A2A-Version on the compat path', async () => {
      const app = createApp(dualVersionCard(), { enabled: true });
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(200);

      assert.equal(response.headers['vary'], 'A2A-Version');
    });

    it('sets Vary: A2A-Version on the v1.0 path when compat is enabled', async () => {
      const app = createApp(dualVersionCard(), { enabled: true });
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '1.0')
        .expect(200);

      assert.equal(response.headers['vary'], 'A2A-Version');
    });

    it('does NOT set Vary when compat is disabled', async () => {
      const app = createApp(modernOnlyCard());
      const response = await request(app).get('/.well-known/agent-card.json').expect(200);

      assert.isUndefined(response.headers['vary']);
    });

    it('preserves an upstream Vary value on the compat (v0.3) success path', async () => {
      const app = createAppWithUpstreamVary(dualVersionCard(), { enabled: true });
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(200);

      // `res.append` merges into the existing comma-separated value
      // instead of overwriting `Accept-Encoding` set by upstream
      // (e.g. compression) middleware.
      assert.equal(response.headers['vary'], 'Accept-Encoding, A2A-Version');
    });

    it('preserves an upstream Vary value on the v1.0 success path', async () => {
      const app = createAppWithUpstreamVary(dualVersionCard(), { enabled: true });
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '1.0')
        .expect(200);

      assert.equal(response.headers['vary'], 'Accept-Encoding, A2A-Version');
    });

    it('preserves an upstream Vary value on the VersionNotSupportedError (400) path', async () => {
      // The only way the legacy router still throws
      // VersionNotSupportedError under synthesis is when the v1.0 card
      // has NO interfaces at all (so there's nothing to synthesize).
      const emptyCard: AgentCard = { ...modernOnlyCard(), supportedInterfaces: [] };
      const app = createAppWithUpstreamVary(emptyCard, { enabled: true });
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(400);

      assert.equal(response.headers['vary'], 'Accept-Encoding, A2A-Version');
    });

    it('preserves an upstream Vary value on the generic 500 error path', async () => {
      // Provider throws a plain Error (not VersionNotSupportedError) so the
      // outer catch in the legacy router is exercised. The Vary header must
      // still be appended so shared HTTP caches don't serve this 500 to a
      // v1.0 client that should have hit the v1.0 handler instead.
      const app = express();
      app.use((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Vary', 'Accept-Encoding');
        next();
      });
      app.use(
        '/.well-known/agent-card.json',
        agentCardHandler({
          agentCardProvider: async () => {
            throw new Error('boom');
          },
          legacyCompat: { enabled: true },
        })
      );

      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(500);

      assert.equal(response.headers['vary'], 'Accept-Encoding, A2A-Version');
    });

    it('emits different ETags for the v0.3 and v1.0 bodies', async () => {
      const app = createApp(dualVersionCard(), { enabled: true });
      const compat = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(200);
      const modern = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '1.0')
        .expect(200);

      assert.isDefined(compat.headers['etag']);
      assert.isDefined(modern.headers['etag']);
      assert.notEqual(compat.headers['etag'], modern.headers['etag']);
    });

    it('returns 304 when If-None-Match matches the per-version ETag', async () => {
      const app = createApp(dualVersionCard(), { enabled: true });
      const first = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(200);
      const etag = first.headers['etag'];

      await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .set('If-None-Match', etag)
        .expect(304);
    });

    it('emits Cache-Control with default max-age on the compat path', async () => {
      const app = createApp(dualVersionCard(), { enabled: true });
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(200);

      assert.equal(response.headers['cache-control'], 'public, max-age=3600');
    });
  });

  describe('error handling', () => {
    it('returns 400 with a v0.3-shaped error when the v1.0 card has no interfaces at all', async () => {
      // With synthesis enabled, a v1.0-only card normally produces a
      // discoverable v0.3 card from the v1.0 interfaces. The only way
      // to still trigger VersionNotSupportedError on the legacy path is
      // a card with NO interfaces at all — there's nothing to
      // synthesize from.
      const emptyCard: AgentCard = { ...modernOnlyCard(), supportedInterfaces: [] };
      const app = createApp(emptyCard, { enabled: true });
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(400);

      // v0.3 error body: bare `{ code, message, data? }`.
      assert.isNumber(response.body.code);
      assert.isString(response.body.message);
      assert.match(response.body.message, /interface/i);
    });

    it('falls through to the v1.0 handler for non-legacy requests against a modern-only card', async () => {
      const app = createApp(modernOnlyCard(), { enabled: true });
      // v1.0 request should NOT get the 400 — the legacy router
      // short-circuits via `next('router')`.
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '1.0')
        .expect(200);

      assert.isArray(response.body.supportedInterfaces);
    });
  });

  describe('synthesized v0.3 card from a v1.0-only card', () => {
    it('serves a synthesized hybrid card on header-less requests (server-side §3.6.2 default-to-0.3 fallback)', async () => {
      const app = createApp(modernOnlyCard(), { enabled: true });

      const response = await request(app).get('/.well-known/agent-card.json').expect(200);

      // v0.3 top-level fields are present (url, preferredTransport,
      // protocolVersion). The v1.0 source `supportedInterfaces[]` is
      // also embedded so v1.0-only peers that didn't send the version
      // header can still discover the native v1.0 endpoints without
      // routing through a compat path they may not have registered.
      assert.equal(response.body.url, 'https://api.example/v1');
      assert.equal(response.body.preferredTransport, 'JSONRPC');
      assert.equal(response.body.protocolVersion, '0.3');
      assert.isArray(response.body.supportedInterfaces);
      assert.deepEqual(response.body.supportedInterfaces, modernOnlyCard().supportedInterfaces);
    });

    it('serves a synthesized v0.3 card on explicit A2A-Version: 0.3 against a v1.0-only card', async () => {
      const app = createApp(modernOnlyCard(), { enabled: true });

      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(200);

      assert.equal(response.body.url, 'https://api.example/v1');
      assert.equal(response.body.protocolVersion, '0.3');
    });

    it('still serves the modern v1.0 card on explicit A2A-Version: 1.0', async () => {
      const app = createApp(modernOnlyCard(), { enabled: true });

      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '1.0')
        .expect(200);

      // v1.0 shape preserved for v1.0 clients.
      assert.isArray(response.body.supportedInterfaces);
      assert.isUndefined(response.body.url);
    });

    it('emits Vary and ETag for synthesized cards too', async () => {
      const app = createApp(modernOnlyCard(), { enabled: true });

      const response = await request(app).get('/.well-known/agent-card.json').expect(200);

      assert.equal(response.headers['vary'], 'A2A-Version');
      assert.isDefined(response.headers['etag']);
    });

    it('passes through all v1.0 interfaces as additionalInterfaces in the synthesized card', async () => {
      const multiBindingCard: AgentCard = {
        ...modernOnlyCard(),
        supportedInterfaces: [
          {
            url: 'https://api.example/v1/jsonrpc',
            protocolBinding: 'JSONRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
          {
            url: 'https://api.example/v1/grpc',
            protocolBinding: 'GRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
        ],
      };
      const app = createApp(multiBindingCard, { enabled: true });

      const response = await request(app).get('/.well-known/agent-card.json').expect(200);

      // Primary is the first v1.0 interface; the rest become
      // additionalInterfaces in v0.3 shape.
      assert.equal(response.body.url, 'https://api.example/v1/jsonrpc');
      assert.equal(response.body.preferredTransport, 'JSONRPC');
      assert.equal(response.body.protocolVersion, '0.3');
      assert.isArray(response.body.additionalInterfaces);
      assert.equal(response.body.additionalInterfaces.length, 1);
      assert.equal(response.body.additionalInterfaces[0].url, 'https://api.example/v1/grpc');
      assert.equal(response.body.additionalInterfaces[0].transport, 'GRPC');
    });

    it('embeds the original v1.0 supportedInterfaces alongside v0.3 fields (hybrid card)', async () => {
      // The single JSON document MUST satisfy both card resolvers:
      // a v0.3 parser reads `url`/`preferredTransport`/
      // `additionalInterfaces`/`protocolVersion`, a v1.0 parser reads
      // `supportedInterfaces[]`. This is the mechanism that lets v1.0
      // peers that skipped `A2A-Version: 1.0` and lack per-binding
      // v0.3 compat (e.g. compat for JSONRPC but not gRPC) still
      // discover the native v1.0 endpoints for those bindings.
      const multiBindingCard: AgentCard = {
        ...modernOnlyCard(),
        supportedInterfaces: [
          {
            url: 'https://api.example/v1/jsonrpc',
            protocolBinding: 'JSONRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
          {
            url: 'https://api.example/v1/grpc',
            protocolBinding: 'GRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
        ],
      };
      const app = createApp(multiBindingCard, { enabled: true });

      const response = await request(app).get('/.well-known/agent-card.json').expect(200);

      // v0.3 surface (synthesized).
      assert.equal(response.body.url, 'https://api.example/v1/jsonrpc');
      assert.equal(response.body.preferredTransport, 'JSONRPC');
      assert.equal(response.body.protocolVersion, '0.3');

      // v1.0 surface (embedded verbatim, retaining the native version
      // stamp).
      assert.isArray(response.body.supportedInterfaces);
      assert.deepEqual(response.body.supportedInterfaces, multiBindingCard.supportedInterfaces);
    });
  });

  describe('back-compat (legacyCompat omitted)', () => {
    it('serves the v1.0 card regardless of A2A-Version header', async () => {
      const app = createApp(legacyOnlyCard());

      // Even with header set, behavior is unchanged from today.
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('A2A-Version', '0.3')
        .expect(200);

      assert.isArray(response.body.supportedInterfaces);
    });
  });
});

describe('legacyAgentCardRouter (standalone)', () => {
  it('serves the v0.3 card when mounted directly', async () => {
    const app = createLegacyOnlyApp(legacyOnlyCard());
    const response = await request(app).get('/.well-known/agent-card.json').expect(200);

    assert.equal(response.body.url, 'https://api.example/a2a');
    assert.equal(response.body.preferredTransport, 'JSONRPC');
    assert.equal(response.body.protocolVersion, '0.3');
  });

  it('synthesizes a v0.3 card from a v1.0-only card when mounted directly', async () => {
    // The standalone router uses the same `synthesize: true` mode as
    // when it's mounted by the core agentCardHandler under
    // `legacyCompat: { enabled: true }`.
    const app = createLegacyOnlyApp(modernOnlyCard());
    const response = await request(app).get('/.well-known/agent-card.json').expect(200);

    assert.equal(response.body.url, 'https://api.example/v1');
    assert.equal(response.body.preferredTransport, 'JSONRPC');
    assert.equal(response.body.protocolVersion, '0.3');
  });

  it('falls through (404) for a v1.0 request when nothing else is mounted', async () => {
    const app = createLegacyOnlyApp(legacyOnlyCard());
    // Without a v1.0 handler mounted after the legacy router,
    // `next('router')` causes Express to return 404.
    await request(app).get('/.well-known/agent-card.json').set('A2A-Version', '1.0').expect(404);
  });

  it('uses application/json content type (not application/a2a+json)', async () => {
    const app = createLegacyOnlyApp(legacyOnlyCard());
    const response = await request(app).get('/.well-known/agent-card.json').expect(200);
    assert.match(response.headers['content-type'], /^application\/json/);
  });
});

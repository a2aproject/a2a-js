import { describe, it, assert } from 'vitest';
import express from 'express';
import request from 'supertest';
import { agentCardHandler } from '../../../src/server/express/index.js';
import { AgentCard } from '../../../src/index.js';

const testAgentCard: AgentCard = {
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
      url: 'http://localhost:8080',
      protocolBinding: 'HTTP+JSON',
      tenant: '',
      protocolVersion: '1.0',
    },
  ],
  capabilities: {
    extensions: [],
    streaming: false,
    pushNotifications: false,
  },
};

function createApp(options?: { maxAge?: number }) {
  const app = express();
  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({
      agentCardProvider: async () => testAgentCard,
      cache: options,
    })
  );
  return app;
}

describe('agentCardHandler', () => {
  it('should return the agent card as JSON', async () => {
    const app = createApp();
    const response = await request(app).get('/.well-known/agent-card.json').expect(200);

    assert.equal(response.body.name, 'Test Agent');
  });

  describe('caching headers (§8.6)', () => {
    it('should include Cache-Control with default max-age', async () => {
      const app = createApp();
      const response = await request(app).get('/.well-known/agent-card.json').expect(200);

      assert.equal(response.headers['cache-control'], 'public, max-age=3600');
    });

    it('should include Cache-Control with custom max-age', async () => {
      const app = createApp({ maxAge: 7200 });
      const response = await request(app).get('/.well-known/agent-card.json').expect(200);

      assert.equal(response.headers['cache-control'], 'public, max-age=7200');
    });

    it('should set Cache-Control to no-cache when maxAge is 0', async () => {
      const app = createApp({ maxAge: 0 });
      const response = await request(app).get('/.well-known/agent-card.json').expect(200);

      assert.equal(response.headers['cache-control'], 'no-cache');
    });

    it('should include an ETag header', async () => {
      const app = createApp();
      const response = await request(app).get('/.well-known/agent-card.json').expect(200);

      assert.isDefined(response.headers['etag']);
      assert.match(response.headers['etag'], /^W\/"[a-f0-9]+"/);
    });

    it('should return consistent ETag for the same agent card', async () => {
      const app = createApp();
      const response1 = await request(app).get('/.well-known/agent-card.json').expect(200);
      const response2 = await request(app).get('/.well-known/agent-card.json').expect(200);

      assert.equal(response1.headers['etag'], response2.headers['etag']);
    });

    it('should return 304 Not Modified when If-None-Match matches ETag', async () => {
      const app = createApp();

      const response1 = await request(app).get('/.well-known/agent-card.json').expect(200);
      const etag = response1.headers['etag'];

      const response2 = await request(app)
        .get('/.well-known/agent-card.json')
        .set('If-None-Match', etag)
        .expect(304);

      assert.deepEqual(response2.body, {});
    });

    it('should return 200 when If-None-Match does not match ETag', async () => {
      const app = createApp();
      const response = await request(app)
        .get('/.well-known/agent-card.json')
        .set('If-None-Match', 'W/"stale-etag"')
        .expect(200);

      assert.equal(response.body.name, 'Test Agent');
    });
  });
});
